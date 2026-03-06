import React, { useState, useEffect } from 'react'
import MainScreen from './screens/MainScreen.jsx'
import UserFormScreen from './screens/UserFormScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'

export default function App() {
  const [tab, setTab] = useState('monitor')
  const [config, setConfig] = useState(null)

  useEffect(() => {
    window.electronAPI.loadConfig().then(setConfig)
  }, [])

  async function saveConfig(updated) {
    setConfig(updated)
    await window.electronAPI.saveConfig(updated)
  }

  if (!config) return <div className="p-4 text-gray-400">Завантаження...</div>

  const tabs = [
    { id: 'monitor', label: 'Монітор' },
    { id: 'user', label: 'Користувач' },
    { id: 'settings', label: 'Налаштування' },
  ]

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      <div className="flex border-b bg-white">
        {tabs.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'monitor' && <MainScreen config={config} />}
        {tab === 'user' && <UserFormScreen config={config} onSave={saveConfig} />}
        {tab === 'settings' && <SettingsScreen config={config} onSave={saveConfig} />}
      </div>
    </div>
  )
}
