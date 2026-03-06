/**
 * Розрахунок вільних слотів — верифікований алгоритм.
 *
 * Ключові нюанси:
 * - NWT не фільтрується по consulIpnHash (hash завжди null, записи вкладені в consul)
 * - Reserved + NWT мержаться в один масив blocking інтервалів
 * - Overlap check для blocking (не exact match)
 * - Timezone з institutions API
 * - numberWeeks з institutions API (горизонт планування)
 * - Гранична умова: slotMinutes + serviceTime <= rangeEndMinutes
 */

function calculateFreeSlots({
  schedules,
  reservedSlots,
  serviceCode,
  slotIntervalMinutes = 10,
  holidays = [],
  minDate,
  timeZone,
  numberWeeks = 25,
}) {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)

  const minDateObj = minDate ? new Date(minDate) : tomorrow
  const effectiveMin = minDateObj > tomorrow ? minDateObj : tomorrow

  const endDate = new Date(now)
  endDate.setDate(endDate.getDate() + numberWeeks * 7)

  const unwrap = (item) => item.data || item

  // Parse timezone offset string like "GMT-07:00" → "-07:00"
  const tzOffset = parseTimezoneOffset(timeZone)

  // Filter consuls who provide the requested service
  const relevantConsuls = schedules.map(unwrap).filter(consul =>
    consul.consularInstitutionService?.some(s => s.code === serviceCode)
  )
  if (relevantConsuls.length === 0) return []

  // Holiday set (YYYY-MM-DD)
  const holidaySet = new Set(holidays.map(h => {
    const raw = typeof h === 'string' ? h : (h.data?.date || h.date)
    if (!raw) return ''
    if (raw.includes('.')) {
      const [d, m, y] = raw.split('.')
      return `${y}-${m}-${d}`
    }
    return raw
  }).filter(Boolean))

  // Reserved slots: group by consulIpnHash → array of {from, to} ms
  const reservedByConsul = new Map()
  for (const rawSlot of reservedSlots) {
    const slot = unwrap(rawSlot)
    const hash = slot.consulIpnHash
    if (!reservedByConsul.has(hash)) reservedByConsul.set(hash, [])
    reservedByConsul.get(hash).push({
      from: new Date(slot.receptionDateAndTimeFrom).getTime(),
      to: new Date(slot.receptionDateAndTimeTo).getTime(),
    })
  }

  const freeSlots = []

  for (const consul of relevantConsuls) {
    const consulHash = consul.consulIpnHash

    // Build work schedule: dayOfWeek → [{from: "09:00", to: "12:30"}, ...]
    const workSchedule = buildWorkSchedule(consul.receptionCitizensTime)

    // Merge ALL blocking intervals: NWT + reserved for this consul
    const nwtBlocks = (consul.nonWorkingTime || []).map(n => ({
      from: new Date(n.notWorkingDateAndHoursFrom).getTime(),
      to: new Date(n.notWorkingDateAndHoursTo).getTime(),
    }))
    const reservedBlocks = reservedByConsul.get(consulHash) || []
    const allBlocking = [...nwtBlocks, ...reservedBlocks]

    // Generate slots for each day
    for (let d = new Date(effectiveMin); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = formatDate(d)
      if (holidaySet.has(dateStr)) continue

      const dayOfWeek = d.getDay()
      const ranges = workSchedule.get(dayOfWeek)
      if (!ranges) continue

      for (const { from, to } of ranges) {
        const rangeStartMinutes = timeToMinutes(from)
        const rangeEndMinutes = timeToMinutes(to)
        let slotMinutes = rangeStartMinutes

        while (slotMinutes + slotIntervalMinutes <= rangeEndMinutes) {
          const slotFromTime = minutesToTime(slotMinutes)
          const slotToTime = minutesToTime(slotMinutes + slotIntervalMinutes)

          // Build ISO timestamps with timezone
          const sfMs = new Date(`${dateStr}T${slotFromTime}:00.000${tzOffset}`).getTime()
          const stMs = new Date(`${dateStr}T${slotToTime}:00.000${tzOffset}`).getTime()

          // Overlap check: slot [sfMs, stMs) intersects block [from, to)?
          let isBlocked = false
          for (const block of allBlocking) {
            if (stMs > block.from && sfMs < block.to) {
              isBlocked = true
              break
            }
          }

          if (!isBlocked) {
            freeSlots.push({
              date: dateStr,
              timeFrom: slotFromTime,
              timeTo: slotToTime,
              consulIpnHash: consulHash,
            })
          }

          slotMinutes += slotIntervalMinutes
        }
      }
    }
  }

  return freeSlots
}

function buildWorkSchedule(receptionCitizensTime) {
  if (!receptionCitizensTime) return new Map()
  const schedule = new Map()
  for (const entry of receptionCitizensTime) {
    // dayOfWeek in API: 1=Mon...7=Sun, JS Date.getDay(): 0=Sun,1=Mon...6=Sat
    const jsDow = entry.dayOfWeek === 7 ? 0 : entry.dayOfWeek
    if (!schedule.has(jsDow)) schedule.set(jsDow, [])
    schedule.get(jsDow).push({
      from: entry.workingHoursFrom,
      to: entry.workingHoursTo,
    })
  }
  return schedule
}

function parseTimezoneOffset(tz) {
  // "GMT-07:00" → "-07:00", "GMT+02:00" → "+02:00"
  if (!tz) return '+00:00'
  const match = tz.match(/([+-]\d{2}:\d{2})/)
  return match ? match[1] : '+00:00'
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, '0')
  const m = String(minutes % 60).padStart(2, '0')
  return `${h}:${m}`
}

function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

module.exports = { calculateFreeSlots }
