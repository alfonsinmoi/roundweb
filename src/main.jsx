import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installAuthInterceptor } from './utils/authState'

// Intercepta TODAS las peticiones fetch del navegador para:
//   - Consumir `X-New-Token` (sliding refresh del JWT)
//   - Redirigir a /login si el backend devuelve 401 en peticiones autenticadas
installAuthInterceptor()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
