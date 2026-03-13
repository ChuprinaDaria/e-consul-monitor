const { BrowserWindow, session } = require('electron')

class BookingEngine {
  constructor({ onLog, onStatus }) {
    this.onLog = onLog || (() => {})
    this.onStatus = onStatus || (() => {})
    this.win = null
    this._authSession = null
  }

  async book(config, targetSlot) {
    this.onLog(`Booking slot: ${targetSlot.date} ${targetSlot.timeFrom}`)
    this.onStatus('booking')

    try {
      this.win = new BrowserWindow({
        width: 1920,
        height: 1080,
        show: false,
        webPreferences: {
          contextIsolation: false,
          nodeIntegration: false,
        },
      })

      const wc = this.win.webContents

      // Step 1: Navigate to login
      await this.win.loadURL('https://id.e-consul.gov.ua/')
      await this._wait(3000)
      this.onLog('Login page loaded')

      // Step 2: KEP login
      if (config.kep.keyPath && config.kep.keyPassword) {
        const loggedIn = await this._loginWithKep(wc, config.kep)
        if (!loggedIn) {
          this.onLog('KEP login failed')
          this.onStatus('error')
          return false
        }
        this.onLog('KEP login successful')
      }

      // Step 3: Wait for redirect to portal
      await this._waitForUrl(wc, 'e-consul.gov.ua/tasks', 30000)
      this.onLog('Redirected to task page')

      // Step 4: Personal data (wizard step 1)
      await this._fillPersonalData(wc, config.user)
      await this._clickNext(wc)
      await this._wait(2000)
      this.onLog('Step 1 (personal data) done')

      // Step 5: Consulate (wizard step 2)
      await this._fillConsulate(wc, config.consulate)
      await this._clickNext(wc)
      await this._wait(2000)
      this.onLog('Step 2 (consulate) done')

      // Step 6: Service (wizard step 3)
      await this._fillService(wc, config.consulate.service)
      await this._clickNext(wc)
      await this._wait(2000)
      this.onLog('Step 3 (service) done')

      // Step 7: Select slot (wizard step 4)
      const booked = await this._selectSlot(wc, targetSlot)
      if (booked) {
        this.onLog('SLOT BOOKED SUCCESSFULLY')
        this.onStatus('booked')
      } else {
        this.onLog('Failed to select slot on calendar')
        this.onStatus('error')
      }
      return booked

    } catch (err) {
      this.onLog(`Booking error: ${err.message}`)
      this.onStatus('error')
      return false
    } finally {
      if (this.win && !this.win.isDestroyed()) {
        this.win.close()
        this.win = null
      }
    }
  }

  /**
   * Auth flow:
   * 1. id.e-consul.gov.ua → click "id.gov.ua"
   * 2. id.gov.ua/bankid-nbu-auth → select bank from dropdown + "Продовжити"
   * 3. api.monobank.ua → extract QR link from #qrcode title
   * 4. Send link to Telegram, wait for user to confirm in app
   * 5. Redirect back to id.e-consul.gov.ua/?code=...
   * 6. React app exchanges code for JWT → localStorage.token
   */
  async startAuth(bankName = 'monobank') {
    this._authSession = session.fromPartition(`auth-${Date.now()}`)

    this.win = new BrowserWindow({
      width: 1920, height: 1080, show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        session: this._authSession,
      },
    })

    const wc = this.win.webContents

    // Step 1: Load e-consul login page
    await this.win.loadURL('https://id.e-consul.gov.ua/')
    await this._wait(4000)
    // Очистити старий токен, щоб не плутати з новим
    await wc.executeJavaScript('localStorage.removeItem("token")')
    this.onLog('Login page loaded')

    // Step 2: Click "id.gov.ua" button (MUI button, 3rd option)
    const clicked = await wc.executeJavaScript(`
      (function() {
        // Try MUI buttons first
        const btns = document.querySelectorAll('.MuiButton-root, button');
        for (const btn of btns) {
          if ((btn.textContent || '').includes('id.gov.ua')) { btn.click(); return true; }
        }
        return false;
      })()
    `)
    if (!clicked) {
      this.onLog('Could not find id.gov.ua button')
      return null
    }
    this.onLog('Clicked id.gov.ua')

    // Wait for id.gov.ua intermediate page ("Увійти за допомогою")
    await this._waitForUrl(wc, 'id.gov.ua', 15000).catch(() => {})
    await this._wait(3000)
    this.onLog('id.gov.ua intermediate page loaded')

    // Step 3: Click "Bank ID НБУ" link on intermediate page
    const bankIdClicked = await wc.executeJavaScript(`
      (function() {
        // Direct selector: a[href="/bankid-nbu-auth"]
        const link = document.querySelector('a[href="/bankid-nbu-auth"]');
        if (link) { link.click(); return true; }
        // Fallback: by text
        const els = document.querySelectorAll('a');
        for (const el of els) {
          if ((el.textContent || '').includes('Bank ID')) { el.click(); return true; }
        }
        return false;
      })()
    `)
    if (!bankIdClicked) {
      this.onLog('Could not find "Bank ID НБУ" link')
      return null
    }
    this.onLog('Clicked Bank ID НБУ')

    // Wait for bankid-nbu-auth page to load (may 503 first)
    await this._waitForUrl(wc, 'bankid-nbu-auth', 20000).catch(() => {})
    await this._wait(4000)
    this.onLog('Bank selection page loaded')

    // Step 4 (was 3): Open jQuery UI selectmenu and pick bank
    const bankKeyword = bankName.toLowerCase()
    // Click the combobox to open dropdown
    const comboboxFound = await wc.executeJavaScript(`
      (function() {
        const btn = document.querySelector('#selBankConnect-button');
        if (btn) { btn.click(); return true; }
        // Fallback: role=combobox
        const cb = document.querySelector('[role="combobox"]');
        if (cb) { cb.click(); return true; }
        return false;
      })()
    `)
    if (!comboboxFound) {
      this.onLog('Could not find bank selector (#selBankConnect-button)')
      return null
    }
    await this._wait(1000)

    // Click the bank option in the dropdown menu
    const bankPicked = await wc.executeJavaScript(`
      (function() {
        const keyword = '${bankKeyword}';
        // jQuery UI selectmenu dropdown
        const items = document.querySelectorAll('#selBankConnect-menu li div, #selBankConnect-menu .ui-menu-item-wrapper');
        for (const item of items) {
          if ((item.textContent || '').toLowerCase().includes(keyword)) {
            item.click(); return true;
          }
        }
        // Fallback: any listbox option
        const opts = document.querySelectorAll('[role="option"]');
        for (const opt of opts) {
          if ((opt.textContent || '').toLowerCase().includes(keyword)) {
            opt.click(); return true;
          }
        }
        return false;
      })()
    `)
    if (!bankPicked) {
      this.onLog('Could not find bank in dropdown: ' + bankName)
      return null
    }
    this.onLog('Selected bank: ' + bankName)
    await this._wait(500)

    // Step 4: Click "Продовжити" (#btnBankIDChoose)
    await wc.executeJavaScript(`
      (function() {
        const btn = document.querySelector('#btnBankIDChoose');
        if (btn) { btn.click(); return true; }
        // Fallback
        const btns = document.querySelectorAll('button, input[type="submit"]');
        for (const b of btns) {
          if ((b.textContent || b.value || '').includes('Продовжити')) { b.click(); return true; }
        }
        return false;
      })()
    `)
    this.onLog('Clicked Продовжити')

    // Step 5: id.bank.gov.ua — second bank selection page
    await this._waitForUrl(wc, 'id.bank.gov.ua', 15000).catch(() => {})
    await this._wait(3000)
    this.onLog('id.bank.gov.ua page loaded')

    const bankClicked2 = await wc.executeJavaScript(`
      (function() {
        const keyword = '${bankKeyword}';
        // a.list-group-bank-name with bank name
        const links = document.querySelectorAll('a.list-group-bank-name, a.list-group-item');
        for (const link of links) {
          if ((link.textContent || '').toLowerCase().includes(keyword)) {
            link.click(); return true;
          }
        }
        // Fallback: any link/element with bank name
        const els = document.querySelectorAll('a, button, [role="button"], div');
        for (const el of els) {
          if ((el.textContent || '').toLowerCase().includes(keyword)) {
            el.click(); return true;
          }
        }
        return false;
      })()
    `)
    if (!bankClicked2) {
      this.onLog('Could not find bank on id.bank.gov.ua: ' + bankName)
      return null
    }
    this.onLog('Clicked bank on id.bank.gov.ua')

    // Step 6: Wait for monobank QR page
    await this._waitForUrl(wc, 'api.monobank.ua', 20000).catch(() => {})
    await this._wait(4000)
    this.onLog('Bank QR page loaded')

    // Step 7: Extract deep link from conf object (conf.baseUrl + conf.bankid)
    // QR renders in #qr-overlay svg, NOT in #qrcode
    // conf.bankid starts with "nbi" and is also logged to console
    const deepLink = await wc.executeJavaScript(`
      (function() {
        return new Promise(function(resolve) {
          function tryExtract() {
            if (typeof conf !== 'undefined' && conf.bankid && conf.baseUrl) {
              return conf.baseUrl + conf.bankid;
            }
            return null;
          }
          // Try immediately
          var link = tryExtract();
          if (link) { resolve(link); return; }
          // Retry every 500ms for up to 10s
          var attempts = 0;
          var timer = setInterval(function() {
            attempts++;
            var link = tryExtract();
            if (link) { clearInterval(timer); resolve(link); return; }
            if (attempts > 20) { clearInterval(timer); resolve(null); }
          }, 500);
        });
      })()
    `)

    if (!deepLink) {
      this.onLog('Could not extract deep link from conf object')
      return null
    }

    this.onLog('Got deep link: ' + deepLink)
    return { qrLink: deepLink }
  }

  /**
   * KEP auth: автоматичний логін через файловий ключ (~15 сек).
   * Не потребує участі юзера — ідеально для авто-релогіну.
   */
  async startAuthKep(kepConfig) {
    this._authSession = session.fromPartition(`auth-${Date.now()}`)

    this.win = new BrowserWindow({
      width: 1920, height: 1080, show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false,
        session: this._authSession,
      },
    })

    const wc = this.win.webContents

    try {
      await this.win.loadURL('https://id.e-consul.gov.ua/')
      await this._wait(4000)
      await wc.executeJavaScript('localStorage.removeItem("token")')
      this.onLog('KEP: Login page loaded')

      const loggedIn = await this._loginWithKep(wc, kepConfig)
      if (!loggedIn) {
        this.onLog('KEP: Login failed — no token')
        return false
      }

      this.onLog('KEP: Auth complete — token found')
      return true
    } catch (err) {
      this.onLog('KEP auth error: ' + err.message)
      return false
    }
  }

  async waitForAuthComplete(timeoutMs = 120000) {
    if (!this.win) return false
    return this._waitForToken(this.win.webContents, timeoutMs)
  }

  async getToken() {
    if (!this.win || this.win.isDestroyed()) return null
    const token = await this.win.webContents.executeJavaScript('localStorage.getItem("token")')
    if (!token) return null
    // Якщо це JWT — перевірити expiry. Якщо opaque token — повертаємо як є.
    try {
      const parts = token.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          this.onLog('Token expired at: ' + new Date(payload.exp * 1000).toISOString())
          return null
        }
      }
    } catch { /* не JWT формат — ок */ }
    return token
  }

  close() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close()
      this.win = null
    }
  }

  // --- Private: Login ---

  async _loginWithKep(wc, kep) {
    // Click "Особистий ключ"
    const clicked = await wc.executeJavaScript(`
      (function() {
        const els = document.querySelectorAll('button, a, [role="button"], label, span');
        for (const el of els) {
          if (el.textContent.includes('Особистий ключ')) { el.click(); return true; }
        }
        return false;
      })()
    `)
    this.onLog('KEP: clicked "Особистий ключ": ' + clicked)
    await this._wait(4000)

    // Клікнути таб "Файловий ключ" (на випадок якщо відкрився інший таб)
    await wc.executeJavaScript(`
      (function() {
        var tab = document.querySelector('#id-app-login-sign-form-tab-file-key');
        if (tab) { tab.click(); return true; }
        return false;
      })()
    `)
    await this._wait(1000)

    // Upload KEP file via CDP з retry
    try {
      wc.debugger.attach('1.3')
      let nodeId = 0
      for (let attempt = 0; attempt < 5; attempt++) {
        const { root } = await wc.debugger.sendCommand('DOM.getDocument')
        const result = await wc.debugger.sendCommand('DOM.querySelector', {
          nodeId: root.nodeId,
          selector: 'input[type="file"]',
        })
        nodeId = result.nodeId
        if (nodeId > 0) break
        this.onLog(`KEP: file input not found, retry ${attempt + 1}/5...`)
        await this._wait(2000)
      }
      if (!nodeId || nodeId === 0) {
        this.onLog('KEP: file input not found after 5 attempts')
        wc.debugger.detach()
        return false
      }
      await wc.debugger.sendCommand('DOM.setFileInputFiles', {
        nodeId,
        files: [kep.keyPath],
      })
      wc.debugger.detach()
      this.onLog('KEP: file uploaded')
    } catch (err) {
      this.onLog('CDP file upload error: ' + err.message)
      try { wc.debugger.detach() } catch {}
      return false
    }

    await this._wait(2000)

    // Fill password
    await wc.executeJavaScript(`
      (function() {
        const pwd = document.querySelector('#id-app-login-sign-form-file-key-password')
          || document.querySelector('input[type="password"]');
        if (!pwd) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(pwd, ${JSON.stringify(kep.keyPassword)});
        pwd.dispatchEvent(new Event('input', {bubbles: true}));
        pwd.dispatchEvent(new Event('change', {bubbles: true}));
        return true;
      })()
    `)
    await this._wait(500)

    // Click "Продовжити" button
    const signClicked = await wc.executeJavaScript(`
      (function() {
        // Точний ID кнопки "Продовжити" на формі KEP
        var btn = document.querySelector('#id-app-login-sign-form-file-key-sign-button');
        if (btn) { btn.click(); return 'by-id'; }
        // Fallback: шукаємо по тексту
        var btns = document.querySelectorAll('button');
        for (var b of btns) {
          if ((b.textContent || '').includes('Продовжити')) { b.click(); return 'by-text'; }
        }
        return false;
      })()
    `)
    this.onLog('KEP sign button: ' + signClicked)

    // Чекаємо токен так само як при BankID: слухаємо навігацію + поллим localStorage
    return await this._waitForToken(wc, 60000)
  }

  /**
   * Спільна логіка очікування токена після логіну (BankID / KEP).
   * Слухає навігацію, клікає "Продовжити" на callback-сторінці, поллить localStorage.
   */
  async _waitForToken(wc, timeoutMs = 60000) {
    let resolved = false
    let callbackClicked = false

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (resolved) return
        resolved = true
        this.onLog('Token wait timeout')
        resolve(false)
      }, timeoutMs)

      const done = async () => {
        if (resolved) return
        // Поллимо localStorage до появи токена (до 30с)
        for (let i = 0; i < 30; i++) {
          if (resolved) return
          try {
            const token = await wc.executeJavaScript('localStorage.getItem("token")')
            if (token && token.length > 20) {
              resolved = true
              clearTimeout(timeout)
              this.onLog('Token found (' + token.length + ' chars)')
              resolve(true)
              return
            }
          } catch {}
          await this._wait(1000)
        }
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          this.onLog('Token never appeared after polling')
          resolve(false)
        }
      }

      const checkUrl = async (url) => {
        if (resolved) return

        // Callback-сторінка "Перевірте дані" — треба клікнути "Продовжити"
        if (url.includes('bankid-auth-callback') && !callbackClicked) {
          callbackClicked = true
          this.onLog('Callback page — clicking Продовжити...')
          await this._wait(2000)
          try {
            await wc.executeJavaScript(`
              (function() {
                var btn = document.querySelector('#btnAcceptUserDataAgreement');
                if (btn) { btn.click(); return true; }
                var btns = document.querySelectorAll('button, input[type="submit"]');
                for (var b of btns) {
                  if ((b.textContent || b.value || '').includes('Продовжити')) { b.click(); return true; }
                }
                return false;
              })()
            `)
            this.onLog('Clicked Продовжити on callback page')
          } catch (err) {
            this.onLog('Error clicking callback button: ' + err.message)
          }
          return
        }

        // Фінальний редірект на портал — починаємо поллити токен
        if (url.includes('e-consul.gov.ua/messages') || url.includes('e-consul.gov.ua/tasks')) {
          done()
        } else if (url.includes('e-consul.gov.ua') && url.includes('code=')) {
          done()
        }
      }

      wc.on('did-navigate', (_evt, url) => checkUrl(url))
      wc.on('did-redirect-navigation', (_evt, url) => checkUrl(url))
      wc.on('will-redirect', (_evt, url) => checkUrl(url))

      // Поллінг як fallback
      const poll = setInterval(async () => {
        if (resolved) { clearInterval(poll); return }
        if (!this.win || this.win.isDestroyed()) {
          clearInterval(poll)
          if (!resolved) { resolved = true; resolve(false) }
          return
        }
        checkUrl(wc.getURL())
        // Перевіряємо токен навіть без редіректу
        if (!resolved) {
          try {
            const token = await wc.executeJavaScript('localStorage.getItem("token")')
            if (token && token.length > 50) {
              done()
            }
          } catch {}
        }
      }, 2000)
    })
  }

  // --- Private: Wizard steps ---

  async _fillPersonalData(wc, user) {
    const [year, month, day] = (user.birthdate || '').split('-')
    if (day) await this._fillMuiInput(wc, 'День', day.replace(/^0/, ''))
    if (month) await this._fillMuiInput(wc, 'Місяць', month.replace(/^0/, ''))
    if (year) await this._fillMuiInput(wc, 'Рік', year)
    if (user.gender) await this._selectMuiOption(wc, 'Стать', user.gender)
  }

  async _fillConsulate(wc, consulate) {
    await this._fillMuiAutocompleteNth(wc, 0, consulate.country)
    await this._wait(1500)
    await this._fillMuiAutocompleteNth(wc, 1, consulate.institution)
  }

  async _fillService(wc, service) {
    await this._fillMuiAutocompleteByLabel(wc, 'Послуга', service)
  }

  async _selectSlot(wc, slot) {
    const result = await wc.executeJavaScript(`
      (function() {
        const cells = document.querySelectorAll('[class*="slot"], [class*="calendar"] td, [class*="calendar"] button, button');
        for (const cell of cells) {
          const text = (cell.textContent || '').trim();
          if (text.includes('${slot.timeFrom}')) {
            cell.click();
            return true;
          }
        }
        return false;
      })()
    `)
    if (result) {
      await this._wait(1000)
      await this._clickNext(wc)
    }
    return result
  }

  async _clickNext(wc) {
    await wc.executeJavaScript(`
      (function() {
        const btns = document.querySelectorAll('button');
        for (const btn of btns) {
          if (btn.textContent.trim() === 'Далі') { btn.click(); return true; }
        }
        return false;
      })()
    `)
  }

  // --- Private: MUI helpers ---

  async _fillMuiInput(wc, label, value) {
    await wc.executeJavaScript(`
      (function() {
        const labels = document.querySelectorAll('label, .MuiInputLabel-root');
        for (const lbl of labels) {
          if (lbl.textContent.includes('${label}')) {
            const container = lbl.closest('.MuiFormControl-root') || lbl.parentElement;
            const input = container.querySelector('input');
            if (input) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, '${value}');
              input.dispatchEvent(new Event('input', {bubbles: true}));
              input.dispatchEvent(new Event('change', {bubbles: true}));
              return true;
            }
          }
        }
        return false;
      })()
    `)
    await this._wait(300)
  }

  async _fillMuiAutocompleteNth(wc, index, value) {
    await wc.executeJavaScript(`
      (function() {
        const roots = document.querySelectorAll('.MuiAutocomplete-root');
        if (roots[${index}]) {
          const input = roots[${index}].querySelector('input');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, '${value}');
            input.dispatchEvent(new Event('input', {bubbles: true}));
            input.focus();
            return true;
          }
        }
        return false;
      })()
    `)
    await this._wait(1500)
    await this._pickOption(wc, value)
  }

  async _fillMuiAutocompleteByLabel(wc, label, value) {
    await wc.executeJavaScript(`
      (function() {
        const labels = document.querySelectorAll('label, .MuiInputLabel-root');
        for (const lbl of labels) {
          if (lbl.textContent.includes('${label}')) {
            const root = lbl.closest('.MuiAutocomplete-root') || lbl.closest('.MuiFormControl-root');
            if (root) {
              const input = root.querySelector('input');
              if (input) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                setter.call(input, '${value}');
                input.dispatchEvent(new Event('input', {bubbles: true}));
                input.focus();
                return true;
              }
            }
            break;
          }
        }
        return false;
      })()
    `)
    await this._wait(1500)
    await this._pickOption(wc, value)
  }

  async _selectMuiOption(wc, label, value) {
    await wc.executeJavaScript(`
      (function() {
        const labels = document.querySelectorAll('label, .MuiInputLabel-root');
        for (const lbl of labels) {
          if (lbl.textContent.includes('${label}')) {
            const container = lbl.closest('.MuiFormControl-root') || lbl.parentElement;
            const select = container.querySelector('[role="button"], .MuiSelect-select');
            if (select) { select.click(); return true; }
          }
        }
        return false;
      })()
    `)
    await this._wait(500)
    await this._pickOption(wc, value)
  }

  async _pickOption(wc, text) {
    await wc.executeJavaScript(`
      (function() {
        const opts = document.querySelectorAll('[role="option"]');
        const lower = '${text}'.toLowerCase();
        for (const o of opts) {
          if ((o.textContent || '').toLowerCase().includes(lower)) {
            o.click();
            return true;
          }
        }
        return false;
      })()
    `)
  }

  // --- Private: Utils ---

  async _waitForUrl(wc, urlPart, timeoutMs = 30000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const url = wc.getURL()
      if (url.includes(urlPart)) return
      await this._wait(500)
    }
    throw new Error('Timeout waiting for URL: ' + urlPart)
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

module.exports = { BookingEngine }
