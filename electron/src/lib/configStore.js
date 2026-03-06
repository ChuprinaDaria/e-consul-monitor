const fs = require('fs')
const path = require('path')

class ConfigStore {
  constructor(basePath) {
    this.filePath = path.join(basePath, 'config.json')
    this._data = null
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this._data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      }
    } catch {
      this._data = null
    }
    if (!this._data) {
      this._data = {
        user: { surname: '', name: '', patronymic: '', birthdate: '', gender: '' },
        consulate: { country: '', institution: '', institutionCode: '', service: '', serviceCode: '' },
        auth: { method: 'monobank' },
        telegram: { botToken: '', recipient: '' },
        monitoring: { pollIntervalMs: 3000, minDate: '' },
      }
    }
    return this._data
  }

  save(data) {
    this._data = data
    const dir = path.dirname(this.filePath)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  get() {
    return this._data || this.load()
  }
}

module.exports = { ConfigStore }
