const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { ConfigStore } = require('./src/lib/configStore')
const { TelegramNotifier } = require('./src/lib/telegramNotifier')
const { SlotMonitor } = require('./src/lib/slotMonitor')
const { BookingEngine } = require('./src/lib/bookingEngine')
const { BookingService } = require('./src/lib/bookingService')
let mainWindow
let configStore
let monitor = null
let telegram = null

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

const PROJECT_ROOT = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  configStore = new ConfigStore(userDataPath)
  configStore.load()
  createWindow()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('project:getRoot', () => PROJECT_ROOT)

ipcMain.handle('config:load', () => configStore.get())
ipcMain.handle('config:save', (_evt, data) => {
  configStore.save(data)
  return true
})

// --- user YAML ---
ipcMain.handle('users:list', () => {
  if (!PROJECT_ROOT) return []
  const dir = path.join(PROJECT_ROOT, 'data', 'users_cfg')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => f.replace(/\.(yaml|yml)$/, ''))
})

ipcMain.handle('users:writeYaml', (_evt, alias, yamlContent) => {
  if (!PROJECT_ROOT) return false
  const dir = path.join(PROJECT_ROOT, 'data', 'users_cfg')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${alias}.yaml`), yamlContent, 'utf8')
  return true
})

ipcMain.handle('users:delete', (_evt, alias) => {
  if (!PROJECT_ROOT) return false
  const p = path.join(PROJECT_ROOT, 'data', 'users_cfg', `${alias}.yaml`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  return true
})

// --- re-auth on 401 ---
const REAUTH_MAX_RETRIES = 3
const REAUTH_RETRY_DELAY_MS = 30000

async function reauth(config, authMethod, attempt = 1) {
  sendToRenderer('monitor:status', 'waiting-auth')
  sendToRenderer('monitor:log', `Token expired — re-auth attempt ${attempt}/${REAUTH_MAX_RETRIES}...`)

  // Close old auth window
  if (authEngine) {
    authEngine.close()
    authEngine = null
  }

  authEngine = new BookingEngine({
    onLog: (msg) => sendToRenderer('monitor:log', msg),
    onStatus: () => {},
  })

  const authResult = await authEngine.startAuth(authMethod)
  if (!authResult) {
    sendToRenderer('monitor:log', 'Re-auth failed — could not get bank page')
    if (attempt < REAUTH_MAX_RETRIES) {
      sendToRenderer('monitor:log', `Retry in ${REAUTH_RETRY_DELAY_MS / 1000}s...`)
      setTimeout(() => reauth(config, authMethod, attempt + 1), REAUTH_RETRY_DELAY_MS)
    } else {
      sendToRenderer('monitor:log', 'All re-auth attempts failed — monitoring paused')
      sendToRenderer('monitor:status', 'stopped')
    }
    return
  }

  // Send new auth link to Telegram (no error messages, just the link)
  await telegram.sendMessage(
    `<b>Токен протух — авторизуйся знову</b>\n\nВідкрий лінк у додатку банку:\n${authResult.qrLink}`
  )
  sendToRenderer('monitor:log', 'Re-auth link sent to Telegram — waiting...')

  const authOk = await authEngine.waitForAuthComplete(120000)
  if (!authOk) {
    sendToRenderer('monitor:log', 'Re-auth timeout')
    if (attempt < REAUTH_MAX_RETRIES) {
      // Resend link on next attempt
      sendToRenderer('monitor:log', `Retry in ${REAUTH_RETRY_DELAY_MS / 1000}s...`)
      setTimeout(() => reauth(config, authMethod, attempt + 1), REAUTH_RETRY_DELAY_MS)
    } else {
      await telegram.sendMessage('<b>Не вдалось переавторизуватись — моніторинг зупинено</b>')
      sendToRenderer('monitor:log', 'All re-auth attempts failed — monitoring paused')
      sendToRenderer('monitor:status', 'stopped')
    }
    return
  }

  const token = await authEngine.getToken()
  sendToRenderer('monitor:log', `Re-auth OK — token: ${token ? 'yes' : 'no'}`)

  // Resume monitoring with new webContents
  if (monitor) {
    monitor.resumeAfterReauth(authEngine.win?.webContents || null)
  }
}

// --- monitor ---
let authEngine = null

ipcMain.handle('monitor:start', async () => {
  const config = configStore.get()
  const authMethod = config.auth?.method || 'monobank'

  telegram = new TelegramNotifier(config.telegram.botToken, config.telegram.recipient)

  sendToRenderer('monitor:status', 'authenticating')

  // Authenticate via bank
  sendToRenderer('monitor:log', `Авторизація через ${authMethod}...`)
  authEngine = new BookingEngine({
    onLog: (msg) => sendToRenderer('monitor:log', msg),
    onStatus: () => {},
  })

  const authResult = await authEngine.startAuth(authMethod)
  if (!authResult) {
    sendToRenderer('monitor:log', 'Auth failed — could not get bank page')
    sendToRenderer('monitor:status', 'stopped')
    authEngine.close()
    authEngine = null
    return false
  }

  // Send auth link to Telegram
  sendToRenderer('monitor:log', 'Sending auth link to Telegram...')
  await telegram.sendMessage(
    `<b>Авторизація е-Консул</b>\n\nВідкрий лінк у додатку банку:\n${authResult.qrLink}`
  )
  sendToRenderer('monitor:log', 'Auth link sent to Telegram — waiting for auth...')
  sendToRenderer('monitor:status', 'waiting-auth')

  // Wait for user to scan QR (2 min timeout)
  const authOk = await authEngine.waitForAuthComplete(120000)
  if (!authOk) {
    sendToRenderer('monitor:log', 'Auth timeout or failed')
    sendToRenderer('monitor:status', 'stopped')
    authEngine.close()
    authEngine = null
    return false
  }

  const token = await authEngine.getToken()
  sendToRenderer('monitor:log', `Auth OK — token: ${token ? 'yes (' + token.length + ' chars)' : 'no'}`)

  // Step 2: Start monitoring — API calls go through the auth browser window
  // This bypasses Cloudflare WAF (real browser TLS fingerprint)
  const wc = authEngine?.win?.webContents || null
  const bookingService = new BookingService({
    api: new (require('./src/lib/eQueueApi').EQueueApi)(wc),
    onLog: (msg) => sendToRenderer('monitor:log', msg),
  })

  let isBooking = false

  monitor = new SlotMonitor({
    webContents: wc,
    onLog: (msg) => sendToRenderer('monitor:log', msg),
    onStatus: (status) => sendToRenderer('monitor:status', status),
    onAuthExpired: () => reauth(config, authMethod),
    onSlotsFound: async (slots) => {
      const top10 = slots.slice(0, 10)
      const lines = top10.map(s =>
        `${s.institutionName ? s.institutionName + ': ' : ''}${s.date} ${s.timeFrom}-${s.timeTo}`
      )
      const text = `<b>Нові слоти!</b>\n${lines.join('\n')}${slots.length > 10 ? '\n...' : ''}\n\nВсього: ${slots.length}`
      await telegram.sendMessage(text)
      sendToRenderer('monitor:log', `Sent ${slots.length} slots to Telegram`)
    },
    onBookingRequest: async (slot, timeZone) => {
      if (isBooking) {
        sendToRenderer('monitor:log', 'Already booking — skip')
        return
      }
      isBooking = true
      sendToRenderer('monitor:status', 'booking')
      sendToRenderer('monitor:log', `Booking: ${slot.institutionName} ${slot.date} ${slot.timeFrom}...`)

      await telegram.sendMessage(
        `<b>Бронюю слот!</b>\n${slot.institutionName}\n${slot.date} ${slot.timeFrom}-${slot.timeTo}`
      )

      const result = await bookingService.book(config, slot, timeZone, [slot.consulIpnHash])

      if (result.success) {
        sendToRenderer('monitor:status', 'booked')
        sendToRenderer('monitor:log', `BOOKED! regNumber: ${result.regNumber}`)
        await telegram.sendMessage(
          `<b>ЗАБРОНЬОВАНО!</b>\n${slot.institutionName}\n${slot.date} ${slot.timeFrom}-${slot.timeTo}\nРеєстраційний номер: ${result.regNumber || 'pending'}`
        )
        // Stop monitoring after successful booking
        if (monitor) monitor.stop()
      } else {
        sendToRenderer('monitor:log', `Booking failed: ${result.error}`)
        await telegram.sendMessage(
          `<b>Не вдалось забронювати</b>\n${slot.date} ${slot.timeFrom}\n${result.error}`
        )
        sendToRenderer('monitor:status', 'monitoring')
      }
      isBooking = false
    },
  })

  monitor.start(config)
  return true
})

ipcMain.handle('monitor:stop', () => {
  if (monitor) {
    monitor.stop()
    monitor = null
  }
  if (authEngine) {
    authEngine.close()
    authEngine = null
  }
  return true
})

// --- telegram ---
ipcMain.handle('telegram:test', async (_evt, token, recipient) => {
  const tg = new TelegramNotifier(token, recipient)
  return tg.sendMessage('e-Consul Monitor: test OK')
})

ipcMain.handle('telegram:resolveChatId', async (_evt, token) => {
  const https = require('https')
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${token}/getUpdates?limit=10`, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          if (data.ok && data.result.length > 0) {
            // Find the most recent message with a chat id
            for (let i = data.result.length - 1; i >= 0; i--) {
              const msg = data.result[i].message || data.result[i].my_chat_member
              if (msg?.chat?.id) {
                resolve(msg.chat.id)
                return
              }
            }
          }
          resolve(null)
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
  })
})

