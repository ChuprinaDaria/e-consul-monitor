const https = require('https')

class TelegramNotifier {
  constructor(botToken, recipient) {
    this.botToken = botToken
    this.recipient = recipient
  }

  update(botToken, recipient) {
    this.botToken = botToken
    this.recipient = recipient
  }

  async sendMessage(text) {
    if (!this.botToken || !this.recipient) return false
    return this._post('sendMessage', {
      chat_id: this.recipient,
      text,
      parse_mode: 'HTML',
    })
  }

  async sendPhoto(photoUrl, caption) {
    if (!this.botToken || !this.recipient) return false
    return this._post('sendPhoto', {
      chat_id: this.recipient,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
    })
  }

  async sendPhotoBuffer(buffer, caption) {
    if (!this.botToken || !this.recipient) return false
    const boundary = '----FormBoundary' + Date.now()
    const parts = []
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${this.recipient}`)
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML`)
    if (caption) {
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`)
    }
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="qr.png"\r\nContent-Type: image/png\r\n\r\n`)
    const head = Buffer.from(parts.join('\r\n') + '\r\n')
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, buffer, tail])

    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}/sendPhoto`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      }, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => resolve(res.statusCode === 200))
      })
      req.on('error', () => resolve(false))
      req.write(body)
      req.end()
    })
  }

  _post(method, payload) {
    return new Promise((resolve) => {
      const data = JSON.stringify(payload)
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${this.botToken}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.log(`[TG] ${method} failed: ${res.statusCode} ${body}`)
          }
          resolve(res.statusCode === 200)
        })
      })
      req.on('error', (err) => {
        console.log(`[TG] ${method} error: ${err.message}`)
        resolve(false)
      })
      req.write(data)
      req.end()
    })
  }
}

module.exports = { TelegramNotifier }
