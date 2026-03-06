function calculateFreeSlots({
  schedules,
  reservedSlots,
  serviceCode,
  serviceName,
  slotIntervalMinutes = 10,
  holidays = [],
  minDate,
}) {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const minDateObj = minDate ? new Date(minDate) : tomorrow
  const effectiveMin = minDateObj > tomorrow ? minDateObj : tomorrow

  // Unwrap .data if API returns wrapped objects
  const unwrap = (item) => item.data || item

  // Filter consuls who provide the requested service (by code, fallback to name)
  const relevantConsuls = schedules.map(unwrap).filter(consul =>
    consul.consularInstitutionService?.some(s =>
      serviceCode
        ? s.code === serviceCode
        : (s.name === serviceName || s.serviceName === serviceName)
    )
  )

  if (relevantConsuls.length === 0) return []

  // Holiday set for fast lookup (YYYY-MM-DD)
  // API returns { date: "DD.MM.YYYY" } objects
  const holidaySet = new Set(holidays.map(h => {
    const raw = typeof h === 'string' ? h : h.date
    if (raw.includes('.')) {
      const [d, m, y] = raw.split('.')
      return `${y}-${m}-${d}`
    }
    return raw // already YYYY-MM-DD
  }))

  // Build reserved lookup: consulHash -> Set of "YYYY-MM-DD HH:MM"
  const reservedMap = new Map()
  for (const rawSlot of reservedSlots) {
    const slot = unwrap(rawSlot)
    const key = slot.consulIpnHash
    if (!reservedMap.has(key)) reservedMap.set(key, new Set())
    const from = new Date(slot.receptionDateAndTimeFrom)
    reservedMap.get(key).add(formatSlotKey(from))
  }

  // Build nonWorking lookup per consul: Map<hash, Array<{from: Date, to: Date}>>
  // NW blocks are 5-min chunks, slots are 10-min — need overlap check
  const nonWorkingMap = new Map()
  for (const consul of relevantConsuls) {
    const blocks = []
    for (const nw of (consul.nonWorkingTime || [])) {
      blocks.push({
        from: new Date(nw.notWorkingDateAndHoursFrom),
        to: new Date(nw.notWorkingDateAndHoursTo),
      })
    }
    nonWorkingMap.set(consul.consulIpnHash, blocks)
  }

  // Generate all possible slots for next 90 days
  const freeSlots = []
  const endDate = new Date(effectiveMin)
  endDate.setDate(endDate.getDate() + 90)

  for (let d = new Date(effectiveMin); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = formatDate(d)
    if (holidaySet.has(dateStr)) continue

    const dayOfWeek = d.getDay()

    for (const consul of relevantConsuls) {
      const workingHours = getWorkingHoursForDay(consul.receptionCitizensTime, dayOfWeek)
      if (!workingHours) continue

      const consulHash = consul.consulIpnHash
      const reserved = reservedMap.get(consulHash) || new Set()
      const nwBlocks = nonWorkingMap.get(consulHash) || []

      for (const { from, to } of workingHours) {
        let slotStart = parseTime(dateStr, from)
        const slotEnd = parseTime(dateStr, to)

        while (slotStart < slotEnd) {
          const slotTo = new Date(slotStart.getTime() + slotIntervalMinutes * 60000)
          const slotKey = formatSlotKey(slotStart)

          // Overlap check: slot [slotStart, slotTo) intersects NW [nw.from, nw.to)
          const isNonWorking = nwBlocks.some(nw =>
            slotStart < nw.to && slotTo > nw.from
          )

          if (!reserved.has(slotKey) && !isNonWorking) {
            freeSlots.push({
              date: dateStr,
              timeFrom: formatTime(slotStart),
              timeTo: formatTime(slotTo),
              consulIpnHash: consulHash,
            })
          }

          slotStart = slotTo
        }
      }
    }
  }

  return freeSlots
}

function getWorkingHoursForDay(receptionCitizensTime, dayOfWeek) {
  if (!receptionCitizensTime) return null
  const scheduleDay = dayOfWeek === 0 ? 7 : dayOfWeek
  const entries = receptionCitizensTime.filter(e => e.dayOfWeek === scheduleDay)
  if (entries.length === 0) return null
  return entries.map(e => ({
    from: e.workingHoursFrom,
    to: e.workingHoursTo,
  }))
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTime(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatSlotKey(d) {
  return `${formatDate(d)} ${formatTime(d)}`
}

function parseTime(dateStr, timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(dateStr)
  d.setHours(h, m, 0, 0)
  return d
}

module.exports = { calculateFreeSlots }
