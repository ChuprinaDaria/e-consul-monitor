const { EQueueApi } = require('./eQueueApi')
const { calculateFreeSlots } = require('./slotCalculator')

const BATCH_SIZE = 20

class SlotMonitor {
  constructor({ webContents, onLog, onStatus, onSlotsFound, onAuthExpired }) {
    this.api = new EQueueApi(webContents)
    this.onLog = onLog || (() => {})
    this.onStatus = onStatus || (() => {})
    this.onSlotsFound = onSlotsFound || (() => {})
    this.onAuthExpired = onAuthExpired || (() => {})
    this._timer = null
    this._previousSlotKeys = new Set()
    this._running = false
    this._reauthing = false
    this._institutionCodes = null // cached list for "all" mode
    this._holidays = []
    this._slotIntervalMap = new Map() // institutionCode → serviceTime in minutes
  }

  start(config) {
    if (this._running) return
    this._running = true
    this._config = config
    this._previousSlotKeys = new Set()
    this._institutionCodes = null
    this._holidays = []
    this._slotIntervalMap = new Map()
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

    // If no institution codes available — resolve them via API
    const hasStaticCodes = config.consulate.institutionCodes?.length > 0 || config.consulate.institutionCode
    if (!hasStaticCodes && config.consulate.country) {
      await this._resolveInstitutionCodes(config.consulate.country)
    }
  }

  async _resolveInstitutionCodes(countryName) {
    try {
      this.onLog(`Resolving consulates for "${countryName}" via API...`)
      const countries = await this.api.getCountries()
      const country = countries.find(c => c.nameShort === countryName)
      if (!country) {
        this.onLog(`Country "${countryName}" not found in API response`)
        return
      }

      const institutions = await this.api.getInstitutions(country.code)
      this._institutionCodes = institutions.map(i => i.unitId).filter(Boolean)
      this.onLog(`Found ${this._institutionCodes.length} consulates in ${countryName}: ${institutions.map(i => i.nameUkr).join(', ')}`)
    } catch (err) {
      this.onLog(`Failed to resolve consulates: ${err.message}`)
    }
  }

  async _poll() {
    if (!this._running) return

    try {
      const { consulate, monitoring } = this._config
      const serviceCode = consulate.serviceCode
      const serviceName = consulate.service

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
          batch.map(code => this._fetchConsulateSlots(code, serviceCode, serviceName))
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

      // Detect NEW slots
      const currentKeys = new Set(allFreeSlots.map(s =>
        `${s.institutionCode} ${s.date} ${s.timeFrom} ${s.consulIpnHash}`
      ))
      const newSlots = allFreeSlots.filter(s => {
        const key = `${s.institutionCode} ${s.date} ${s.timeFrom} ${s.consulIpnHash}`
        return !this._previousSlotKeys.has(key)
      })

      if (newSlots.length > 0 && this._previousSlotKeys.size > 0) {
        this.onLog(`NEW slots detected: ${newSlots.length}`)
        this.onStatus('found')
        this.onSlotsFound(newSlots)
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

  async _fetchConsulateSlots(institutionCode, serviceCode, serviceName) {
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

    const freeSlots = calculateFreeSlots({
      schedules: matching,
      reservedSlots: reserved,
      serviceCode,
      serviceName,
      slotIntervalMinutes,
      holidays: this._holidays,
      minDate: this._config.monitoring?.minDate,
    })

    // Tag each slot with institution info
    return freeSlots.map(s => ({
      ...s,
      institutionCode,
      institutionName,
    }))
  }

  _scheduleNext() {
    if (!this._running) return
    const interval = this._config?.monitoring?.pollIntervalMs || 3000
    this._timer = setTimeout(() => this._poll(), interval)
  }
}

module.exports = { SlotMonitor }
