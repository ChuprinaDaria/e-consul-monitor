const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // project
  getRoot: () => ipcRenderer.invoke('project:getRoot'),

  // config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (data) => ipcRenderer.invoke('config:save', data),

  // users
  listUsers: () => ipcRenderer.invoke('users:list'),
  writeUserYaml: (alias, yaml) => ipcRenderer.invoke('users:writeYaml', alias, yaml),
  deleteUser: (alias) => ipcRenderer.invoke('users:delete', alias),

  // telegram
  testTelegram: (token, recipient) => ipcRenderer.invoke('telegram:test', token, recipient),
  resolveChatId: (token) => ipcRenderer.invoke('telegram:resolveChatId', token),

  // monitor
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor: () => ipcRenderer.invoke('monitor:stop'),
  onLog: (cb) => {
    ipcRenderer.removeAllListeners('monitor:log')
    ipcRenderer.on('monitor:log', (_e, msg) => cb(msg))
  },
  onMonitorStatus: (cb) => {
    ipcRenderer.removeAllListeners('monitor:status')
    ipcRenderer.on('monitor:status', (_e, status) => cb(status))
  },
})
