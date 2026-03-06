import React, { useState, useEffect } from 'react'
import LogPanel from '../components/LogPanel.jsx'
import StatusBadge from '../components/StatusBadge.jsx'

export default function MainScreen({ config }) {
  const [status, setStatus] = useState('stopped')
  const [logs, setLogs] = useState([])

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
    } else {
      setLogs(['Monitor not yet implemented — coming in Task 6'])
    }
  }

  function handleStop() {
    if (window.electronAPI.stopMonitor) {
      window.electronAPI.stopMonitor()
    }
  }

  const hasConsulate = config.consulate.institution || config.consulate.monitorAll
  const isConfigured = hasConsulate && config.consulate.service
    && config.telegram.botToken && config.telegram.recipient

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
