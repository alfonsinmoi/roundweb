import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    allowedHosts: true,
    proxy: {
      '/wiemspro': {
        target: 'https://pro.wiemspro.com',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const time = new Date().toLocaleTimeString('es-ES')
            const method = req.method
            const url = req.url
            const body = req._body || ''
            console.log(`\x1b[36m[${time}]\x1b[0m \x1b[33m${method}\x1b[0m ${url}${body ? ` \x1b[90m${typeof body === 'string' ? body.slice(0, 200) : ''}\x1b[0m` : ''}`)
          })

          proxy.on('proxyRes', (proxyRes, req) => {
            const time = new Date().toLocaleTimeString('es-ES')
            const status = proxyRes.statusCode
            const color = status < 300 ? '\x1b[32m' : status < 400 ? '\x1b[33m' : '\x1b[31m'
            console.log(`\x1b[36m[${time}]\x1b[0m ${color}${status}\x1b[0m ← ${req.method} ${req.url}`)
          })
        },
      },
    },
  },
})
