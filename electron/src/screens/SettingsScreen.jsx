import React, { useState } from 'react'

export default function SettingsScreen({ config, onSave }) {
  const [authMethod, setAuthMethod] = useState(config.auth?.method || 'monobank')
  const [kepKeyPath, setKepKeyPath] = useState(config.kep?.keyPath || '')
  const [kepPassword, setKepPassword] = useState(config.kep?.keyPassword || '')
  const [botToken, setBotToken] = useState(config.telegram.botToken)
  const [recipient, setRecipient] = useState(config.telegram.recipient)
  const [pollInterval, setPollInterval] = useState(config.monitoring.pollIntervalMs)
  const [testStatus, setTestStatus] = useState(null)
  const [saved, setSaved] = useState(false)

  const authOptions = [
    { value: 'kep', label: 'Особистий ключ (КЕП)' },
    { value: 'monobank', label: 'id.gov.ua → Monobank' },
    { value: 'privatbank', label: 'id.gov.ua → ПриватБанк' },
    { value: 'oschadbank', label: 'id.gov.ua → Ощадбанк' },
  ]

  async function handleSelectKeyFile() {
    const filePath = await window.electronAPI.selectKeyFile()
    if (filePath) setKepKeyPath(filePath)
  }

  async function handleSave() {
    await onSave({
      ...config,
      auth: { method: authMethod },
      kep: { keyPath: kepKeyPath, keyPassword: kepPassword },
      telegram: { botToken, recipient },
      monitoring: { ...config.monitoring, pollIntervalMs: pollInterval },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleTest() {
    if (!window.electronAPI.testTelegram) {
      setTestStatus('not-ready')
      setTimeout(() => setTestStatus(null), 2000)
      return
    }
    setTestStatus('sending')
    const ok = await window.electronAPI.testTelegram(botToken, recipient)
    setTestStatus(ok ? 'ok' : 'fail')
    setTimeout(() => setTestStatus(null), 3000)
  }

  const inputCls = 'w-full border rounded px-3 py-2 text-sm'
  const labelCls = 'block text-sm font-medium mb-1'

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h2 className="text-lg font-bold">Налаштування</h2>

      <section>
        <h3 className="font-semibold mb-2">Авторизація</h3>
        <div>
          <label className={labelCls}>Метод входу на е-Консул</label>
          <select className={inputCls} value={authMethod} onChange={e => setAuthMethod(e.target.value)}>
            {authOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {authMethod === 'kep' ? (
          <div className="mt-3 space-y-2">
            <div>
              <label className={labelCls}>Файл ключа</label>
              <div className="flex gap-2">
                <input className={inputCls + ' flex-1'} value={kepKeyPath} readOnly placeholder="Не вибрано" />
                <button onClick={handleSelectKeyFile}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm whitespace-nowrap">
                  Вибрати файл
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">.jks, .pfx, .pk8, .zs2, .dat</p>
            </div>
            <div>
              <label className={labelCls}>Пароль ключа</label>
              <input className={inputCls} type="password" value={kepPassword}
                onChange={e => setKepPassword(e.target.value)} placeholder="Пароль від КЕП" />
            </div>
            <p className="text-xs text-gray-500">
              КЕП — повністю автоматично (~15 сек), не потребує участі юзера
            </p>
          </div>
        ) : (
          <p className="text-xs text-gray-500 mt-1">
            При старті бот відкриє сторінку банку, надішле лінк у Telegram — скануй у додатку банку
          </p>
        )}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Telegram</h3>
        <div>
          <label className={labelCls}>Bot Token</label>
          <input className={inputCls} value={botToken} onChange={e => setBotToken(e.target.value.trim())} />
        </div>
        <div className="mt-2">
          <label className={labelCls}>Отримувач (числовий Chat ID)</label>
          <input className={inputCls} value={recipient} placeholder="123456789" onChange={e => setRecipient(e.target.value.trim())} />
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={handleTest}
            className="px-4 py-2 bg-blue-100 hover:bg-blue-200 rounded text-sm">
            Тест
          </button>
          <button onClick={async () => {
            if (!botToken) return
            setTestStatus('resolving')
            const chatId = await window.electronAPI.resolveChatId(botToken)
            if (chatId) {
              setRecipient(String(chatId))
              setTestStatus('resolved')
            } else {
              setTestStatus('resolve-fail')
            }
            setTimeout(() => setTestStatus(null), 3000)
          }} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm">
            Отримати Chat ID
          </button>
        </div>
        {testStatus === 'ok' && <span className="text-green-600 text-sm">OK</span>}
        {testStatus === 'fail' && <span className="text-red-600 text-sm">Помилка — перевір токен і chat_id</span>}
        {testStatus === 'resolved' && <span className="text-green-600 text-sm">Chat ID знайдено!</span>}
        {testStatus === 'resolve-fail' && <span className="text-red-600 text-sm">Напиши боту /start і спробуй знову</span>}
        {testStatus === 'not-ready' && <span className="text-gray-500 text-sm">Буде в Task 4</span>}
      </section>

      <section>
        <h3 className="font-semibold mb-2">Моніторинг</h3>
        <div>
          <label className={labelCls}>Інтервал опитування (мс)</label>
          <input className={inputCls} type="number" min="1000" step="1000"
            value={pollInterval} onChange={e => setPollInterval(Number(e.target.value))} />
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={handleSave}
          className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium">
          Зберегти
        </button>
        {saved && <span className="text-green-600 text-sm">Збережено!</span>}
      </div>
    </div>
  )
}
