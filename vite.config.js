import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    allowedHosts: ['localhost'],
    proxy: {
      '/wiemspro': {
        target: 'https://pro.wiemspro.com',
        changeOrigin: true,
        secure: false, // Required: backend cert not fully trusted in dev proxy
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const time = new Date().toLocaleTimeString('es-ES')
            const url = req.url
            // Redact body for auth endpoints
            const isAuth = url.includes('/loginEasy')
            const body = isAuth ? '[REDACTED]' : (req._body || '')
            console.log(`\x1b[36m[${time}]\x1b[0m \x1b[33m${req.method}\x1b[0m ${url}${body && !isAuth ? ` \x1b[90m${typeof body === 'string' ? body.slice(0, 200) : ''}\x1b[0m` : ''}`)
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router')) return 'vendor'
          if (id.includes('node_modules/lucide-react')) return 'icons'
        },
      },
    },
  },
})
