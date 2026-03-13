const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { ConfigStore } = require('./src/lib/configStore')
const { TelegramNotifier } = require('./src/lib/telegramNotifier')
const { SlotMonitor } = require('./src/lib/slotMonitor')
const { BookingEngine } = require('./src/lib/bookingEngine')
const { BookingService } = require('./src/lib/bookingService')
const ECONSUL_LINK = { linkUrl: 'https://e-consul.gov.ua/', linkText: '🌐 Відкрити e-Consul' }

let mainWindow
let configStore
let monitor = null
let telegram = null

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec} сек`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} хв`
  const hrs = Math.floor(min / 60)
  const remainMin = min % 60
  return remainMin > 0 ? `${hrs} год ${remainMin} хв` : `${hrs} год`
}

function formatSlotsMessage(title, slots) {
  // Group by consulate
  const byConsulate = new Map()
  for (const s of slots) {
    const name = s.institutionName || s.institutionCode
    if (!byConsulate.has(name)) byConsulate.set(name, [])
    byConsulate.get(name).push(s)
  }

  let text = `${title}\n`
  for (const [name, consulSlots] of byConsulate) {
    text += `\n<b>${name.toUpperCase()}</b>\n`
    const show = consulSlots.slice(0, 10)
    for (const s of show) {
      const duration = s.availableMs > 0 ? ` (доступний ${formatDuration(s.availableMs)})` : ''
      text += `  📅 ${s.date}  🕐 ${s.timeFrom}-${s.timeTo}${duration}\n`
    }
    if (consulSlots.length > 10) {
      text += `  ...ще ${consulSlots.length - 10}\n`
    }
  }
  text += `\nВсього: <b>${slots.length}</b>`
  return text
}

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
  // macOS: без Edit-меню Cmd+C/V/X не працюють в input-полях
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]))
  }

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

// --- KEP file picker ---
ipcMain.handle('dialog:selectKeyFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'KEP ключі', extensions: ['jks', 'pfx', 'pk8', 'zs2', 'dat'] }],
  })
  return result.filePaths[0] || null
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

  // KEP: автоматичний перелогін (~15 сек, без участі юзера)
  if (authMethod === 'kep') {
    const kepConfig = config.kep
    if (!kepConfig?.keyPath || !kepConfig?.keyPassword) {
      sendToRenderer('monitor:log', 'KEP re-auth failed — no key path or password')
      sendToRenderer('monitor:status', 'stopped')
      return
    }

    const ok = await authEngine.startAuthKep(kepConfig)
    if (ok) {
      sendToRenderer('monitor:log', 'KEP re-auth OK')
      if (telegram) await telegram.sendMessage('🔑 <b>Переавторизація KEP — OK</b>', ECONSUL_LINK)
      if (monitor) monitor.resumeAfterReauth(authEngine.win?.webContents || null)
    } else {
      sendToRenderer('monitor:log', `KEP re-auth failed (attempt ${attempt})`)
      if (attempt < REAUTH_MAX_RETRIES) {
        sendToRenderer('monitor:log', `Retry in ${REAUTH_RETRY_DELAY_MS / 1000}s...`)
        setTimeout(() => reauth(config, authMethod, attempt + 1), REAUTH_RETRY_DELAY_MS)
      } else {
        if (telegram) await telegram.sendMessage('❌ <b>KEP переавторизація не вдалась — моніторинг зупинено</b>')
        sendToRenderer('monitor:log', 'All KEP re-auth attempts failed — monitoring paused')
        sendToRenderer('monitor:status', 'stopped')
      }
    }
    return
  }

  // BankID: потребує участі юзера (QR → Telegram → скан у додатку)
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

  const botToken = (config.telegram.botToken || '').trim()
  const recipient = (config.telegram.recipient || '').trim()
  telegram = new TelegramNotifier(botToken, recipient)

  sendToRenderer('monitor:status', 'authenticating')
  sendToRenderer('monitor:log', `Авторизація через ${authMethod}...`)

  authEngine = new BookingEngine({
    onLog: (msg) => sendToRenderer('monitor:log', msg),
    onStatus: () => {},
  })

  if (authMethod === 'kep') {
    // KEP: автоматичний логін (~15 сек, без участі юзера)
    const kepConfig = config.kep
    if (!kepConfig?.keyPath || !kepConfig?.keyPassword) {
      sendToRenderer('monitor:log', 'KEP auth failed — no key path or password configured')
      sendToRenderer('monitor:status', 'stopped')
      authEngine.close()
      authEngine = null
      return false
    }

    const kepOk = await authEngine.startAuthKep(kepConfig)
    if (!kepOk) {
      sendToRenderer('monitor:log', 'KEP auth failed')
      sendToRenderer('monitor:status', 'stopped')
      authEngine.close()
      authEngine = null
      return false
    }

    const token = await authEngine.getToken()
    sendToRenderer('monitor:log', `KEP auth OK — token: ${token ? 'yes (' + token.length + ' chars)' : 'no'}`)
    if (telegram) await telegram.sendMessage('🔑 <b>KEP авторизація — OK</b>\nМоніторинг запущено', ECONSUL_LINK)
  } else {
    // BankID: потребує участі юзера
    const authResult = await authEngine.startAuth(authMethod)
    if (!authResult) {
      sendToRenderer('monitor:log', 'Auth failed — could not get bank page')
      sendToRenderer('monitor:status', 'stopped')
      authEngine.close()
      authEngine = null
      return false
    }

    sendToRenderer('monitor:log', `Sending auth link to Telegram (bot=${botToken.slice(0,10)}... chat=${recipient})...`)
    const sent = await telegram.sendMessage(
      `<b>Авторизація е-Консул</b>\n\nВідкрий лінк у додатку банку:\n${authResult.qrLink}`
    )
    if (sent) {
      sendToRenderer('monitor:log', 'Auth link sent to Telegram — waiting for auth...')
    } else {
      sendToRenderer('monitor:log', 'FAILED to send auth link to Telegram — check bot token and chat ID')
    }
    sendToRenderer('monitor:status', 'waiting-auth')

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
  }

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
      const text = formatSlotsMessage('🔔 <b>НОВІ СЛОТИ!</b>', slots)
      await telegram.sendMessage(text, ECONSUL_LINK)
      sendToRenderer('monitor:log', `Sent ${slots.length} slots to Telegram`)
    },
    onSlotsGone: async (slots) => {
      if (!telegram) return
      const byConsulate = new Map()
      for (const s of slots) {
        const name = s.institutionName || s.institutionCode
        if (!byConsulate.has(name)) byConsulate.set(name, [])
        byConsulate.get(name).push(s)
      }
      let text = '❌ <b>Слоти зникли</b>\n'
      for (const [name, consulSlots] of byConsulate) {
        text += `\n<b>${name.toUpperCase()}</b>\n`
        for (const s of consulSlots.slice(0, 10)) {
          text += `  ${s.date} ${s.timeFrom}-${s.timeTo} — був доступний ${formatDuration(s.availableMs)}\n`
        }
        if (consulSlots.length > 10) text += `  ...ще ${consulSlots.length - 10}\n`
      }
      await telegram.sendMessage(text, ECONSUL_LINK)
      sendToRenderer('monitor:log', `Notified ${slots.length} slots gone`)
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
        `⏳ <b>БРОНЮЮ СЛОТ!</b>\n\n<b>${(slot.institutionName || '').toUpperCase()}</b>\n📅 ${slot.date}  🕐 ${slot.timeFrom}-${slot.timeTo}`,
        ECONSUL_LINK
      )

      const result = await bookingService.book(config, slot, timeZone, [slot.consulIpnHash])

      if (result.success) {
        sendToRenderer('monitor:status', 'booked')
        sendToRenderer('monitor:log', `BOOKED! regNumber: ${result.regNumber}`)
        await telegram.sendMessage(
          `✅ <b>ЗАБРОНЬОВАНО!</b>\n\n<b>${(slot.institutionName || '').toUpperCase()}</b>\n📅 ${slot.date}  🕐 ${slot.timeFrom}-${slot.timeTo}\n🔖 Реєстраційний номер: <code>${result.regNumber || 'pending'}</code>`,
          ECONSUL_LINK
        )
        // Stop monitoring after successful booking
        if (monitor) monitor.stop()
      } else {
        sendToRenderer('monitor:log', `Booking failed: ${result.error}`)
        await telegram.sendMessage(
          `❌ <b>Не вдалось забронювати</b>\n\n<b>${(slot.institutionName || '').toUpperCase()}</b>\n📅 ${slot.date}  🕐 ${slot.timeFrom}\n\n${result.error}`,
          ECONSUL_LINK
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
  const cleanToken = (token || '').trim()
  const cleanRecipient = (recipient || '').trim()
  console.log(`[telegram:test] token="${cleanToken.slice(0, 10)}..." recipient="${cleanRecipient}"`)
  const tg = new TelegramNotifier(cleanToken, cleanRecipient)
  const ok = await tg.sendMessage('e-Consul Monitor: test OK')
  console.log(`[telegram:test] result=${ok}`)
  return ok
})

ipcMain.handle('telegram:resolveChatId', async (_evt, token) => {
  const https = require('https')
  const cleanToken = (token || '').trim()
  return new Promise((resolve) => {
    https.get(`https://api.telegram.org/bot${cleanToken}/getUpdates?limit=10`, (res) => {
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

