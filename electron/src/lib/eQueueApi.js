/**
 * EQueueApi — makes requests to my.e-consul.gov.ua/external_reader
 * Uses BrowserWindow webContents to execute fetch() from page context,
 * bypassing Cloudflare WAF (proper TLS fingerprint, no bot detection).
 */
class EQueueApi {
  constructor(webContents = null) {
    this._wc = webContents
  }

  setWebContents(wc) {
    this._wc = wc
  }

  // --- Public API (no auth needed) ---

  async getCountries() {
    const data = await this._request('e-queue-register', 'public-get-countries', {
      searchNotEqual: 804,
      offset: 0,
      limit: 1000,
      sortBy: { 'data.nameShort': 'asc' },
    })
    const items = Array.isArray(data) ? data : (data.data || [])
    return items.map(item => {
      const d = item.data || item
      return { code: d.code, alpha2: d.alpha2, nameShort: d.nameShort, nameEng: d.nameEng }
    })
  }

  async getInstitutions(countryCode) {
    const data = await this._request('e-queue-register', 'public-get-institutions', {
      searchEqual3: String(countryCode),
      offset: 0,
      limit: 1000,
      sortBy: { 'data.institutionNameUkr': 'asc' },
    })
    const items = Array.isArray(data) ? data : (data.data || [])
    return items.map(item => {
      const d = item.data || item
      return {
        unitId: d.unitId,
        nameUkr: d.institutionNameUkr,
        nameEng: d.institutionNameEng,
        city: d.city || d.institutionCity,
      }
    })
  }

  async getServicesForInstitution(unitId) {
    const data = await this._request('e-queue-register', 'public-get-services-and-time', {
      searchEqual3: String(unitId),
      offset: 0,
      limit: 1000,
      sortBy: { 'data.serviceName': 'asc' },
    })
    const items = Array.isArray(data) ? data : (data.data || [])
    return items.map(item => {
      const d = item.data || item
      return {
        serviceNumber: d.serviceNumber,
        serviceName: d.serviceName,
        serviceTime: d.serviceTime,
        consularInstitutionId: d.consularInstitutionId,
      }
    })
  }

  // --- Authenticated API ---

  async getConsulSchedules(institutionCode) {
    return this._request('e-queue-register', 'public-calendar-get-actual-consuls-schedule', {
      institutionCode,
    })
  }

  async getAllInstitutionCodes(serviceCode) {
    const data = await this._request('e-queue-register', 'public-get-services-and-time', {
      offset: 0,
      limit: 10000,
      sortBy: { 'data.serviceName': 'asc' },
    })
    const items = Array.isArray(data) ? data : (data.data || [])
    const codes = new Set()
    for (const item of items) {
      const d = item.data || item
      if (d.serviceNumber === serviceCode) {
        codes.add(d.consularInstitutionId)
      }
    }
    return [...codes]
  }

  async getHolidays() {
    return this._request('e-queue-register', 'public-get-holidays', {})
  }

  async getServicesAndTime() {
    return this._request('e-queue-register', 'public-get-services-and-time', {
      offset: 0,
      limit: 10000,
      sortBy: { 'data.serviceName': 'asc' },
    })
  }

  async getReservedSlots(institutionCode, consulIpnHashes) {
    const data = await this._request('e-queue-register', 'public-get-consuls-reserved-slots', {
      institutionCode,
      status: [1, 2, 4, 5],
      consulIpnHash: consulIpnHashes,
    })
    // API returns { status, reservedSlots: [...] }, not a plain array
    return data.reservedSlots || data
  }

  async _request(service, method, filters) {
    if (!this._wc) {
      throw new Error('No webContents — cannot make API request without authenticated browser')
    }

    const payload = JSON.stringify({ service, method, filters })

    const result = await this._wc.executeJavaScript(`
      (async function() {
        try {
          const token = localStorage.getItem('token') || '';
          const res = await fetch('https://my.e-consul.gov.ua/external_reader', {
            method: 'POST',
            cache: 'reload',
            headers: {
              'Content-Type': 'application/json',
              'token': token
            },
            body: ${JSON.stringify(payload)}
          });
          const json = await res.json();
          return { ok: true, data: json.data || json, status: res.status };
        } catch (err) {
          return { ok: false, error: err.message };
        }
      })()
    `)

    if (!result.ok) {
      throw new Error(`API error from ${method}: ${result.error}`)
    }

    if (result.status === 401) {
      const err = new Error(`Auth expired (401) on ${method}`)
      err.status = 401
      throw err
    }

    return result.data
  }
}

module.exports = { EQueueApi }
