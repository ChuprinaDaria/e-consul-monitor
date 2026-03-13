import React, { useState, useEffect } from 'react'
import LogPanel from '../components/LogPanel.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

export default function MainScreen({ config, onSave }) {
  const [status, setStatus] = useState('stopped')
  const [logs, setLogs] = useState([])
  const mode = config.monitoring?.mode || 'search'

  useEffect(() => {
    if (window.electronAPI.onMonitorStatus) {
      window.electronAPI.onMonitorStatus((s) => setStatus(s))
    }
    if (window.electronAPI.onLog) {
      window.electronAPI.onLog((msg) => {
        setLogs(prev => [...prev.slice(-499), msg])
      })
    }
  }, [])

  function handleStart() {
    if (window.electronAPI.startMonitor) {
      window.electronAPI.startMonitor()
      setLogs([])
    }
  }

  function handleStop() {
    if (window.electronAPI.stopMonitor) {
      window.electronAPI.stopMonitor()
    }
  }

  async function switchMode(newMode) {
    await onSave({
      ...config,
      monitoring: { ...config.monitoring, mode: newMode },
    })
  }

  const hasConsulate = config.consulate.institution || config.consulate.monitorAll
  const isConfigured = hasConsulate && config.consulate.service
    && config.telegram.botToken && config.telegram.recipient

  const modeBtnCls = (m) =>
    `px-4 py-1.5 text-sm font-medium rounded-full transition-colors ${
      mode === m
        ? 'bg-blue-600 text-white'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">e-Consul Monitor</h1>
          <StatusBadge status={status} />
        </div>
        <div className="flex gap-2">
          {status === 'stopped' ? (
            <button onClick={handleStart} disabled={!isConfigured}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm disabled:opacity-50">
              Старт
            </button>
          ) : (
            <button onClick={handleStop}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm">
              Стоп
            </button>
          )}
        </div>
      </div>

      {/* Mode switcher */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500 mr-1">Режим:</span>
        <button onClick={() => switchMode('search')} className={modeBtnCls('search')}>
          Шукати
        </button>
        <button onClick={() => switchMode('book')} className={modeBtnCls('book')}>
          Бронювати
        </button>
      </div>

      {mode === 'book' && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm space-y-1">
          <p className="font-medium text-amber-800">Режим бронювання</p>
          <p className="text-amber-700">
            При знаходженні слоту в заданому інтервалі — автоматичне бронювання.
            {config.monitoring.bookingDateFrom && config.monitoring.bookingDateTo
              ? ` Дати: ${config.monitoring.bookingDateFrom} — ${config.monitoring.bookingDateTo}`
              : ' Діапазон дат не задано — вкажи у вкладці "Користувач"'}
          </p>
        </div>
      )}

      {!isConfigured && (
        <p className="text-sm text-amber-600">
          Заповни дані користувача та Telegram у відповідних вкладках
        </p>
      )}

      <div className="flex-1">
        <LogPanel lines={logs} />
      </div>
    </div>
  )
}
