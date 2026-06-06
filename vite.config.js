import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Plugin que emite `version.json` al final del build con un timestamp + hash
 * único por build. El frontend hace polling cada N segundos a ese archivo
 * (cache-busted) y si el `build` cambia respecto al que se cargó al arranque,
 * muestra un banner "Nueva versión disponible".
 */
function emitVersionPlugin() {
  return {
    name: 'emit-version-json',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir || 'dist'
      // Hash corto basado en timestamp — suficiente para detectar cambios.
      // Si quieres reproducibilidad puedes usar el commit hash de git en su lugar.
      const ts = Date.now()
      const build = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const payload = {
        build,
        builtAt: new Date(ts).toISOString(),
      }
      writeFileSync(join(outDir, 'version.json'), JSON.stringify(payload, null, 2))
      // Inyectar el build id en una constante global para que el JS sepa con
      // qué versión arrancó (lo usa el hook `useVersionCheck`).
      // Se hace generando un .js que el index.html puede leer; pero más simple:
      // lo escribimos en window.__ROUND_BUILD__ dentro de index.html.
      // En la práctica el hook lee la respuesta inicial de /version.json y se
      // queda con ese valor — no es estrictamente necesario inyectarlo.
      // Lo dejamos solo en version.json para mantenerlo simple.
      // eslint-disable-next-line no-console
      console.log(`[version] build=${build} (${payload.builtAt})`)
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    emitVersionPlugin(),
  ],
  server: {
    allowedHosts: ['localhost'],
    proxy: {
      // Proxy a NoofitPro (sólo se usa en algunas pantallas, llamada directa).
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
      // Proxy al backend Round Config API en producción (vive en noofit.wiemspro.com).
      // En dev (localhost:5173) reenviamos /api/* y /reserva/* a producción para
      // ver datos reales sin tener que levantar Flask local.
      '/api': {
        target: 'https://noofit.wiemspro.com',
        changeOrigin: true,
        secure: true,
      },
      '/reserva': {
        target: 'https://noofit.wiemspro.com',
        changeOrigin: true,
        secure: true,
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
