import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import { cpSync } from 'fs'

function copyLibPlugin() {
  return {
    name: 'copy-electron-lib',
    closeBundle() {
      try {
        cpSync('src/lib', 'dist-electron/src/lib', { recursive: true })
      } catch {}
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'main.js',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
          plugins: [copyLibPlugin()],
        },
      },
      {
        entry: 'preload.js',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
    ]),
  ],
})
