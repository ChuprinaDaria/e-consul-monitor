const { EQueueApi } = require('./eQueueApi')
const { calculateFreeSlots } = require('./slotCalculator')

const BATCH_SIZE = 20

class SlotMonitor {
  constructor({ webContents, onLog, onStatus, onSlotsFound, onSlotsGone, onBookingRequest, onAuthExpired }) {
    this.api = new EQueueApi(webContents)
    this.onLog = onLog || (() => {})
    this.onStatus = onStatus || (() => {})
    this.onSlotsFound = onSlotsFound || (() => {})
    this.onSlotsGone = onSlotsGone || (() => {})
    this.onBookingRequest = onBookingRequest || (() => {})
    this.onAuthExpired = onAuthExpired || (() => {})
    this._timer = null
    this._previousSlotKeys = new Set()
    this._notifiedSlotKeys = new Set() // накопичувальний — слот надсилається в ТГ лише раз
    this._slotFirstSeen = new Map() // slotKey → { timestamp, slot }
    this._running = false
    this._reauthing = false
    this._institutionCodes = null // cached list for "all" mode
    this._holidays = []
    this._slotIntervalMap = new Map() // institutionCode → serviceTime in minutes
    this._institutionMeta = new Map() // institutionCode → { timeZone, numberWeeks }
  }

  start(config) {
    if (this._running) return
    this._running = true
    this._config = config
    this._previousSlotKeys = new Set()
    this._notifiedSlotKeys = new Set()
    this._slotFirstSeen = new Map()
    this._institutionCodes = null
    this._holidays = []
    this._slotIntervalMap = new Map()
    this._institutionMeta = new Map()
    this.onStatus('monitoring')
    this.onLog('Monitoring started')
    this._loadReferenceData(config).then(() => this._poll())
  }

  resumeAfterReauth(webContents) {
    this.api.setWebContents(webContents)
    this._reauthing = false
    this.onLog('Re-auth complete — resuming monitoring')
    this.onStatus('monitoring')
    this._poll()
  }

  stop() {
    this._running = false
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this.onStatus('stopped')
    this.onLog('Monitoring stopped')
  }

  async _loadReferenceData(config) {
    try {
      const serviceCode = config.consulate.serviceCode
      const [holidaysData, servicesData] = await Promise.all([
        this.api.getHolidays(),
        this.api.getServicesAndTime(),
      ])

      // Holidays: API returns [{ date: "25.12.2026" }, ...]
      this._holidays = Array.isArray(holidaysData) ? holidaysData : (holidaysData.data || [])
      this.onLog(`Loaded ${this._holidays.length} holidays`)

      // ServiceTime: build institutionCode → serviceTime map
      const items = Array.isArray(servicesData) ? servicesData : (servicesData.data || [])
      this._slotIntervalMap = new Map()
      for (const item of items) {
        const d = item.data || item
        if (d.serviceNumber === serviceCode) {
          this._slotIntervalMap.set(d.consularInstitutionId, parseInt(d.serviceTime) || 10)
        }
      }
      this.onLog(`Loaded serviceTime for ${this._slotIntervalMap.size} consulates`)
    } catch (err) {
      this.onLog(`Failed to load reference data: ${err.message} — using defaults`)
    }

    // Resolve institution metadata (timeZone, numberWeeks) and missing codes via API
    if (config.consulate.country) {
      await this._resolveInstitutionData(config)
    }
  }

  async _resolveInstitutionData(config) {
    try {
      this.onLog(`Loading institution data for "${config.consulate.country}"...`)
      const countries = await this.api.getCountries()
      const country = countries.find(c => c.nameShort === config.consulate.country)
      if (!country) {
        this.onLog(`Country "${config.consulate.country}" not found in API`)
        return
      }

      const institutions = await this.api.getInstitutions(country.code)

      // Save metadata (timeZone, numberWeeks) per institution
      for (const inst of institutions) {
        if (inst.unitId) {
          this._institutionMeta.set(inst.unitId, {
            timeZone: inst.timeZone,
            numberWeeks: inst.numberWeeks,
          })
        }
      }
      this.onLog(`Loaded metadata for ${this._institutionMeta.size} consulates (tz, weeks)`)

      // If no static codes — use resolved ones
      const hasStaticCodes = config.consulate.institutionCodes?.length > 0 || config.consulate.institutionCode
      if (!hasStaticCodes) {
        this._institutionCodes = institutions.map(i => i.unitId).filter(Boolean)
        this.onLog(`Resolved ${this._institutionCodes.length} consulates: ${institutions.map(i => i.nameUkr).join(', ')}`)
      }
    } catch (err) {
      this.onLog(`Failed to load institution data: ${err.message}`)
    }
  }

  async _poll() {
    if (!this._running) return

    try {
      const { consulate, monitoring } = this._config
      const serviceCode = consulate.serviceCode

      // Determine which institution codes to monitor
      let codes = []
      if (consulate.institutionCodes && consulate.institutionCodes.length > 0) {
        codes = consulate.institutionCodes
      } else if (this._institutionCodes && this._institutionCodes.length > 0) {
        codes = this._institutionCodes
      } else if (consulate.institutionCode) {
        codes = [consulate.institutionCode]
      } else {
        this.onLog('ERROR: no consulates selected — country may not have institution codes')
        this.stop()
        return
      }

      // Fetch slots for all consulates in parallel batches
      const allFreeSlots = []
      for (let i = 0; i < codes.length; i += BATCH_SIZE) {
        if (!this._running) return
        const batch = codes.slice(i, i + BATCH_SIZE)
        const batchNum = Math.floor(i / BATCH_SIZE) + 1
        const totalBatches = Math.ceil(codes.length / BATCH_SIZE)
        if (codes.length > 1) {
          this.onLog(`Batch ${batchNum}/${totalBatches} (${batch.length} consulates)...`)
        }

        const results = await Promise.allSettled(
          batch.map(code => this._fetchConsulateSlots(code, serviceCode))
        )

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            allFreeSlots.push(...result.value)
          } else if (result.status === 'rejected' && result.reason?.status === 401) {
            throw result.reason // bubble up 401
          }
        }
      }

      this.onLog(`Total free slots across ${codes.length} consulate(s): ${allFreeSlots.length}`)

      // Detect slots never notified before (accumulative — no duplicates from "flickering")
      const slotKey = (s) => `${s.institutionCode} ${s.date} ${s.timeFrom} ${s.consulIpnHash}`
      const now = Date.now()
      const currentKeys = new Set(allFreeSlots.map(slotKey))

      // Track firstSeen for all current slots
      for (const s of allFreeSlots) {
        const key = slotKey(s)
        if (!this._slotFirstSeen.has(key)) {
          this._slotFirstSeen.set(key, { timestamp: now, slot: s })
        }
      }

      // Detect disappeared slots and notify
      const goneSlots = []
      for (const [key, { timestamp, slot }] of this._slotFirstSeen) {
        if (!currentKeys.has(key)) {
          goneSlots.push({ ...slot, availableMs: now - timestamp })
          this._slotFirstSeen.delete(key)
        }
      }
      if (goneSlots.length > 0) {
        this.onLog(`Slots gone: ${goneSlots.length}`)
        this.onSlotsGone(goneSlots)
      }

      const neverNotified = allFreeSlots.filter(s => !this._notifiedSlotKeys.has(slotKey(s)))

      const isFirstPoll = this._previousSlotKeys.size === 0
      const mode = this._config.monitoring?.mode

      // Enrich slots with availability duration
      const enriched = neverNotified.map(s => {
        const entry = this._slotFirstSeen.get(slotKey(s))
        return { ...s, availableMs: entry ? now - entry.timestamp : 0 }
      })

      // Telegram: надсилаємо тільки ті, про які ще не повідомляли (скіпаємо перший пол в search)
      if (enriched.length > 0 && (mode === 'book' || !isFirstPoll)) {
        this.onLog(`NEW slots detected: ${enriched.length}`)
        this.onStatus('found')
        this.onSlotsFound(enriched)
        for (const s of neverNotified) {
          this._notifiedSlotKeys.add(slotKey(s))
        }
      }

      // Auto-booking: перевіряємо і на першому полі
      if (mode === 'book') {
        const slotsToCheck = isFirstPoll ? allFreeSlots : neverNotified
        if (slotsToCheck.length > 0) {
          if (isFirstPoll) {
            this.onLog(`First poll in booking mode — checking ${slotsToCheck.length} existing slots...`)
          }
          const bookableSlot = this._findBookableSlot(slotsToCheck)
          if (bookableSlot) {
            const meta = this._institutionMeta.get(bookableSlot.institutionCode) || {}
            this.onLog(`AUTO-BOOK: ${bookableSlot.institutionName} ${bookableSlot.date} ${bookableSlot.timeFrom}`)
            this.onBookingRequest(bookableSlot, meta.timeZone)
          }
        }
      }

      this._previousSlotKeys = currentKeys

    } catch (err) {
      if (err.status === 401 && !this._reauthing) {
        this._reauthing = true
        this.onLog('Token expired (401) — requesting re-auth...')
        this.onAuthExpired()
        return
      }
      this.onLog(`Poll error: ${err.message}`)
    }

    this._scheduleNext()
  }

  async _fetchConsulateSlots(institutionCode, serviceCode) {
    const schedules = await this.api.getConsulSchedules(institutionCode)
    if (!Array.isArray(schedules) || schedules.length === 0) return []

    const unwrap = (item) => item.data || item
    const matching = schedules.filter(s =>
      unwrap(s).consularInstitutionService?.some(svc => svc.code === serviceCode)
    )
    if (matching.length === 0) return []

    const consulHashes = matching.map(s => unwrap(s).consulIpnHash).filter(Boolean)
    const institutionName = unwrap(matching[0]).institutionName || institutionCode

    const reserved = await this.api.getReservedSlots(institutionCode, consulHashes)

    const slotIntervalMinutes = this._slotIntervalMap.get(institutionCode) || 10
    const meta = this._institutionMeta.get(institutionCode) || {}

    const freeSlots = calculateFreeSlots({
      schedules: matching,
      reservedSlots: reserved,
      serviceCode,
      slotIntervalMinutes,
      holidays: this._holidays,
      minDate: this._config.monitoring?.minDate,
      timeZone: meta.timeZone,
      numberWeeks: meta.numberWeeks || 25,
    })

    // Tag each slot with institution info
    return freeSlots.map(s => ({
      ...s,
      institutionCode,
      institutionName,
    }))
  }

  _findBookableSlot(slots) {
    const timeFrom = this._config.monitoring?.bookingTimeFrom
    const timeTo = this._config.monitoring?.bookingTimeTo

    if (!timeFrom || !timeTo) {
      this.onLog('Booking mode active but no time interval set — skipping auto-book')
      return null
    }

    // Filter slots within the desired time interval
    const matching = slots.filter(s => s.timeFrom >= timeFrom && s.timeFrom < timeTo)

    if (matching.length === 0) {
      this.onLog(`No slots in booking interval ${timeFrom}-${timeTo}`)
      return null
    }

    // Pick the earliest slot
    matching.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.timeFrom.localeCompare(b.timeFrom)
    })

    return matching[0]
  }

  _scheduleNext() {
    if (!this._running) return
    const interval = this._config?.monitoring?.pollIntervalMs || 3000
    this._timer = setTimeout(() => this._poll(), interval)
  }
}

module.exports = { SlotMonitor }
