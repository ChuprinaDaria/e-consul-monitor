/**
 * BookingService — бронює слот через REST API (без UI automation).
 *
 * 4 фази:
 * 1. Створення документа (POST /documents)
 * 2. Заповнення кроків 1-3 (PUT /documents/{docId})
 * 3. Вибір слоту (PUT /documents/{docId})
 * 4. Підтвердження (5 послідовних викликів)
 */

class BookingService {
  constructor({ api, onLog }) {
    this.api = api
    this.onLog = onLog || (() => {})
  }

  /**
   * Book a slot.
   * @param {Object} config - full app config (user, consulate, etc.)
   * @param {Object} slot - { date, timeFrom, timeTo, consulIpnHash, institutionCode, institutionName }
   * @param {string} timeZone - e.g. "GMT-07:00"
   * @param {string[]} allConsulHashes - all consul hashes available at this time
   * @returns {{ success: boolean, regNumber?: string, error?: string }}
   */
  async book(config, slot, timeZone, allConsulHashes) {
    try {
      // Phase 1: Create document
      this.onLog('Phase 1: Creating document...')
      const doc = await this.api.createDocument()
      const docId = doc.documentId || doc.data?.documentId || doc.id
      const taskId = doc.taskId || doc.data?.taskId
      if (!docId) {
        return { success: false, error: 'No documentId in response' }
      }
      this.onLog(`Document created: ${docId}`)

      // Phase 2: Fill steps 1-3
      this.onLog('Phase 2: Filling personal data & consulate...')
      const logId = doc.lastUpdateLogId || doc.data?.lastUpdateLogId
      await this._fillSteps(docId, config, logId)
      this.onLog('Steps 1-3 filled')

      // Phase 3: Select slot
      this.onLog(`Phase 3: Selecting slot ${slot.date} ${slot.timeFrom}-${slot.timeTo}...`)
      await this._selectSlot(docId, slot, timeZone, allConsulHashes)
      this.onLog('Slot selected')

      // Phase 4: Confirm (5 sequential calls)
      this.onLog('Phase 4: Confirming booking...')
      const result = await this._confirm(docId, taskId)
      if (result.success) {
        this.onLog(`BOOKED! regNumber: ${result.regNumber}`)
      }
      return result

    } catch (err) {
      this.onLog(`Booking error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  async _fillSteps(docId, config, logId) {
    const { user, consulate, bookingFor } = config
    const properties = [
      { path: 'consularServiceInfo.whoReceivesService.1', value: 'applicant' },
      { path: 'consularServiceInfo.personArray.0.lastName', value: user.surname },
      { path: 'consularServiceInfo.personArray.0.firstName', value: user.name },
    ]

    if (user.patronymic) {
      properties.push({ path: 'consularServiceInfo.personArray.0.middleName', value: user.patronymic })
    }
    if (user.birthdate) {
      properties.push({ path: 'consularServiceInfo.personArray.0.birthday', value: user.birthdate })
    }
    if (user.gender) {
      properties.push({
        path: 'consularServiceInfo.personArray.0.sex',
        value: user.gender === 'Чоловіча' ? 'male' : 'female',
      })
    }

    // Booking for child/ward: додаємо whoReceivesService.2 = 'child' + дані осіб
    if (bookingFor?.target === 'other' && bookingFor.persons?.length > 0) {
      properties.push({ path: 'consularServiceInfo.whoReceivesService.2', value: 'child' })
      bookingFor.persons.forEach((person, i) => {
        const idx = i + 1 // personArray.0 = applicant, personArray.1+ = children
        properties.push({ path: `consularServiceInfo.personArray.${idx}.lastName`, value: person.surname })
        properties.push({ path: `consularServiceInfo.personArray.${idx}.firstName`, value: person.name })
        if (person.patronymic && !person.noPatronymic) {
          properties.push({ path: `consularServiceInfo.personArray.${idx}.middleName`, value: person.patronymic })
        }
      })
    }

    // Consulate & service
    if (consulate.country) {
      properties.push({ path: 'consularServiceInfo.country', value: consulate.country })
    }
    if (consulate.institution) {
      properties.push({ path: 'consularServiceInfo.institution', value: consulate.institution })
    }
    if (consulate.institutionCode) {
      properties.push({ path: 'consularServiceInfo.institutionCode', value: consulate.institutionCode })
    }
    if (consulate.service) {
      properties.push({ path: 'consularServiceInfo.service', value: consulate.service })
    }
    if (consulate.serviceCode) {
      properties.push({ path: 'consularServiceInfo.serviceCode', value: consulate.serviceCode })
    }

    await this.api.updateDocument(docId, properties, logId)
  }

  async _selectSlot(docId, slot, timeZone, allConsulHashes) {
    const tzOffset = this._parseTzOffset(timeZone)
    const fromISO = `${slot.date}T${slot.timeFrom}:00.00${tzOffset}`
    const toISO = `${slot.date}T${slot.timeTo}:00.00${tzOffset}`
    const fromISOShort = `${slot.date}T${slot.timeFrom}:00${tzOffset}`
    const toISOShort = `${slot.date}T${slot.timeTo}:00${tzOffset}`
    const slotId = `${fromISOShort}-${toISOShort}`

    const calendarValue = {
      chosenSlots: [{
        id: slotId,
        from: fromISO,
        to: toISO,
        addition: {
          consulIpnHash: slot.consulIpnHash,
        },
        status: 'inaccessible',
        consulIpnHash: allConsulHashes || [slot.consulIpnHash],
      }],
      chosenDays: [],
      status: 'filled',
    }

    await this.api.updateDocument(docId, [{
      path: 'dateAndTimeVisitInfo.calendar',
      value: calendarValue,
    }])
  }

  async _confirm(docId, taskId) {
    // 4.1 Check existing appointments
    this.onLog('  4.1: Checking existing appointments...')
    await this.api.externalReaderCheck(
      docId,
      'e-queue-register',
      'public-get-booked-appointments',
      'dateAndTimeVisitInfo.externalReaderCheck_AppointmentVisit'
    )

    // 4.2 Book the slot
    this.onLog('  4.2: Booking slot...')
    const bookResult = await this.api.externalReaderCheck(
      docId,
      'e-queue-register',
      'public-check-and-book-appointments',
      'dateAndTimeVisitInfo.externalReaderCheck_CreatingVisitAppointment'
    )

    // Extract regNumber from response
    let regNumber = null
    const bookingData = bookResult?.data?.properties || bookResult?.properties || []
    for (const prop of bookingData) {
      if (prop.path?.includes('CreatingVisitAppointment')) {
        const val = Array.isArray(prop.value) ? prop.value[0] : prop.value
        regNumber = val?.data?.regNumber || val?.regNumber
        if (regNumber) break
      }
    }

    // 4.3 Prepare
    this.onLog('  4.3: Preparing document...')
    await this.api.prepareDocument(docId)

    // 4.4 Save booking result
    if (regNumber) {
      this.onLog(`  4.4: Saving result (regNumber: ${regNumber})...`)
      // We skip the detailed PUT since the server already has the data from 4.2
    }

    // 4.5 Validate & commit
    this.onLog('  4.5: Validating & committing...')
    const validateResult = await this.api.validateDocument(docId, true)
    const committed = validateResult?.data === true || validateResult === true

    // Poll task status
    if (taskId) {
      this.onLog('  Polling task status...')
      for (let i = 0; i < 5; i++) {
        try {
          await this._wait(2000)
          await this.api.getTaskLast(taskId)
        } catch { break }
      }
    }

    return {
      success: committed || !!regNumber,
      regNumber: regNumber || null,
      documentId: docId,
    }
  }

  _parseTzOffset(tz) {
    if (!tz) return '+00:00'
    const match = tz.match(/([+-]\d{2}:\d{2})/)
    return match ? match[1] : '+00:00'
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

module.exports = { BookingService }
