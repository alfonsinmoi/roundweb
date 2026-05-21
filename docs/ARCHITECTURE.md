# Round Web — Arquitectura y funcionamiento

> Documento de onboarding para devs nuevos. Léelo entero antes de tocar código.
> Complemento de [`CONTRIBUTING.md`](../CONTRIBUTING.md) (workflow git/PR) y de
> [`CLAUDE.md`](../CLAUDE.md) (infraestructura del VPS).

---

## 1. Visión general

**Round Training Center** es la web de administración del SaaS de gimnasios
Round, que se monta sobre la API de **NoofitPro** (`pro.wiemspro.com`).
La web sirve a 3 perfiles de usuario:

- **Manager** (dueño del centro) — login NoofitPro, ve todo
- **Trainer** (entrenador) — login NoofitPro, vista filtrada
- **Usuario web** (recepcionista, admin, etc.) — login propio con perfil de permisos

URL pública: `https://round.wiemspro.com`

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Build | **Vite 8** (rolldown) |
| Framework | **React 19** + **React Router 7** |
| Estilos | Tailwind 4 + CSS variables (sin Tailwind class arbitrarias, ver `index.css`) |
| Iconos | `lucide-react` |
| Tests | **Vitest 4** + Testing Library |
| Backends que consume | NoofitPro (`/wiemspro/*`) + Round Backend Flask (`/api/*`) |
| Auth | Sesión en `sessionStorage` (no cookies, no localStorage) |

---

## 3. Estructura del repo

```
src/
├── components/        Componentes reutilizables (UI, modales, banners)
│   ├── UI.jsx         Design system base: Card, Btn, Badge, Input, Modal helpers
│   ├── Modal.jsx      Modal accesible con focus trap + Escape
│   ├── Toast.jsx      Sistema de notificaciones (useToast)
│   ├── ConfirmDialog  Reemplazo de window.confirm
│   ├── Header.jsx     Cabecera con título, ThemeToggle, TrainerFilterBar
│   ├── Sidebar.jsx    Navegación lateral (lee navItems + permisos)
│   ├── Layout.jsx     Wrapper con sidebar + main + ErrorBoundary por ruta
│   ├── informe/       Componentes del Informe de Asistencia
│   ├── notas/         CRM-notas del cliente
│   └── subs/          Cards de cuota/descuento/modificación
├── contexts/
│   ├── AuthContext.jsx       Login dual + sliding refresh + global expired event
│   └── TrainerFilterContext  Selector de trainer global (impersonación admin)
├── config/
│   └── routes.js      Catálogo de navItems con `perm:` por gating
├── hooks/             useCategoriasMap, etc.
├── pages/             Una página por ruta (lazy-loaded en App.jsx)
│   ├── Login.jsx
│   ├── Dashboard.jsx
│   ├── Clients/       ClientList, ClientProfile, NewClient
│   ├── Clases.jsx + ClaseDetalle.jsx
│   ├── CRM/, Contabilidad/, Configuracion/, CuotasClientes/, ...
├── utils/
│   ├── api.js                 NoofitPro client (todos los /wiemspro/*)
│   ├── configApi.js           Round backend client (config/cuotas/notas/etc.)
│   ├── authUsuarioApi.js      /api/auth/usuario-web/* (login web)
│   ├── authState.js           Interceptor global fetch + sliding refresh
│   ├── cuotasApi.js, notasApi.js, subscriptionsApi.js  Helpers por área
│   ├── validators.js          IBAN, DNI, email, teléfono
│   ├── formatters.js          fechas/horas
│   ├── colors.js              colorFromName, tipoLabel/Color (ejercicios)
│   └── prefetch.js            warm-up cache tras login
└── test/setup.js
```

---

## 4. Sistema de rutas

[`src/App.jsx`](../src/App.jsx) define todas las rutas. Cada página se carga
con `React.lazy()` para code-splitting (un chunk por página).

Estructura:

```jsx
<Routes>
  <Route path="/login"     element={user ? <Navigate to="/clientes"/> : <Login/>}/>
  <Route path="/verificar" element={<VerifyAccount mode="verify"/>}/>
  <Route path="/reset"     element={<VerifyAccount mode="reset"/>}/>

  <Route element={<RequireAuth><Layout/></RequireAuth>}>
    <Route path="/dashboard" element={<Dashboard/>}/>
    <Route path="/clientes"  element={<ClientList/>}/>
    {/* … resto de rutas autenticadas … */}
  </Route>

  <Route path="*" element={<RequireAuth><NotFound/></RequireAuth>}/>
</Routes>
```

- `RequireAuth` redirige a `/login?return=<pathname>` si no hay sesión.
- Cuando el usuario hace login y `?return=…` venía en la URL, vuelve a esa página.
- Las páginas además se gatean por `perm:` (ver `routes.js` + `permissions.js`).
- Sidebar/Header se renderizan dentro de `<Layout/>`, con `<ErrorBoundary key={pathname}/>` para que un crash en una página no rompa la navegación.

---

## 5. Autenticación — flujo dual

Hay **dos backends de login** y `AuthContext.login()` los prueba en orden:

### 5.1 Login `usuario_web` (cuentas web admin propias de Round)

```
POST /api/auth/usuario-web/login
Body: { email, password }
→ 200 { ok:true, token (JWT propio), usuario, noofit: { token, manager } }
→ 200 { ok:false, must_change_password:true, … }   (forzar cambio)
→ 401 { ok:false, error:'invalid_credentials' }    (cae al siguiente)
```

El backend Round verifica las credenciales **y además** loguea a NoofitPro
por debajo con las credenciales del manager (guardadas en `manager_config`).
Devuelve los dos tokens. La web los guarda como `jwt` (Round) y `token`
(NoofitPro) y los usa en paralelo según el endpoint.

### 5.2 Fallback: login NoofitPro (manager/trainer existente)

```
POST /wiemspro/account/loginEasy
Body: { email, password (MD5 uppercase), appVersion }
→ 200 con headers X-CustomToken + X-TRAINER_MANAGER
```

Si esto también falla → muestra "Credenciales incorrectas".

### 5.3 Persistencia y sliding refresh

- La sesión se serializa en `sessionStorage` con la key `round_session`.
- En cada respuesta a `/api/*`, el backend Round puede devolver un
  `X-New-Token` con el JWT renovado. El interceptor en
  [`authState.js`](../src/utils/authState.js) lo lee y lo actualiza
  silenciosamente en sessionStorage.
- Si una petición autenticada devuelve 401 y el body parece "token expirado"
  (`invalid_token`, `expir`, etc.), se dispara `handleAuthExpired()`:
  limpia la sesión, dispara el evento `round:auth-expired` (capturado por
  `AuthContext`) y redirige a `/login?return=<actual>`.

### 5.4 Impersonación (TrainerFilter)

Un manager puede usar el selector global en el header (`<TrainerFilterBar/>`)
para ver la app **como si fuese** un trainer concreto. Esto:

- Guarda `round.trainer_filter` en sessionStorage
- `configApi.headers()` añade `X-Round-Trainer-Id: <id>` a cada request
- El backend filtra los datos como si el trainer estuviese logueado

---

## 6. Capa de datos — dos clientes API

### 6.1 `utils/api.js` → NoofitPro

Cliente para `/wiemspro/*` (proxy a `https://pro.wiemspro.com`).
Headers:

```
X-CustomToken: <token NoofitPro>
X-TRAINER_MANAGER: <manager id>
locale: es
appVersion: 1.8.39
appId: 1
```

Helpers genéricos:

| Función | Uso |
|---|---|
| `apiGet(path, {abortKey})` | GET con wrapper `{mensaje:'OK', …}` |
| `apiPost(path, body, headers, {abortKey})` | POST con mismo wrapper |
| `apiGetRaw(path)` | GET sin wrapper (ERP raw JSON) |
| `apiPostRaw(path, body)` | POST devolviendo `{status, ok, data, text}` para errores granulares |
| `apiDeleteRaw(path, body)` | DELETE arbitrario |

Endpoints nombrados frecuentes:

```js
getClientes()                     // lista paginada
getSalas() / getSalasByRange(d,h) // Clases — la 2ª evita cargar todo
getUsuariosBySala(idSala)
getTrainingsUser(idCliente)       // entrenamientos del cliente
getActividades()                  // catálogo de tipos de clase
getEstadoFisicoSessions(idCli)    // tests físicos
```

**Cache en memoria** (`Map<key, {data, ts}>`) con TTL = 5 min y eviction LRU
al llegar a 50 entradas. `invalidateCache(key?)` limpia una o todas.

**AbortController** opcional: pasar `{abortKey: 'algo'}` cancela cualquier
petición previa con la misma key (útil para búsquedas/filtros rápidos).

### 6.2 `utils/configApi.js` → Backend Round (Flask)

Cliente para `/api/config/*`, `/api/cuotas/*`, `/api/clientes-atendidos/*`,
`/api/trainer-data/*`, `/api/retos/*`. Headers:

```
X-Round-Token:        <token compartido, inyectado en build>
X-Round-Manager-Id:   <id_manager de BD Round>
X-Round-Trainer-Id:   <solo si impersonando o filtro global>
Content-Type:         application/json
```

**Importante**: `X-Round-Token` se inyecta en build desde la variable Vite
`VITE_CONFIG_API_TOKEN` (ver §10). Sin esa variable el backend devolverá 401
en cada petición y el interceptor te tirará al login en bucle.

### 6.3 `utils/authState.js` — interceptor global

`installAuthInterceptor()` (llamado en `main.jsx` una vez) monkey-patchea
`window.fetch` para que TODAS las llamadas:

1. Lean `X-New-Token` de la respuesta y refresquen el JWT
2. Si responden 401 y son autenticadas + el body sugiere expiración → llaman
   a `handleAuthExpired()` (limpia sesión, redirige a `/login`)
3. Los 401 de un POST a `/login` sin Bearer (credenciales malas en formulario)
   NO disparan el redirect — son errores de usuario, no de sesión

### 6.4 ¿Qué cliente usar?

- ¿La URL empieza por `/wiemspro/`? → `api.js`
- ¿La URL empieza por `/api/`? → `configApi.js` (o `notasApi.js` / `cuotasApi.js` / `authUsuarioApi.js` si ya existe wrapper específico)

---

## 7. Sistema de diseño

[`src/index.css`](../src/index.css) define **todas** las variables CSS.
No metas hex hardcodeados en componentes — usa la variable.

**Paleta:**

| Var | Para |
|---|---|
| `--bg-0..4` | Fondos (oscuro a más oscuro) |
| `--text-0..3` | Texto (claro → terciario) |
| `--green`, `--blue`, `--red`, `--amber`, `--violet`, `--rose`, `--orange` | Acentos |
| `--green-bg`, `--green-border` (y variantes por color) | Backgrounds y bordes semitransparentes |
| `--gradient-primary` | El gradiente verde del logo/CTA |
| `--line`, `--line-2`, `--line-strong` | Separadores |
| `--radius-xs..xl, --radius-pill` | Border radius |
| `--space-1..16` | Espaciado (escala 4px) |
| `--shadow-sm/md/lg` | Sombras |

**Tema claro**: activado con `<html data-theme="light">` (lo gestiona
`<ThemeToggle/>`). Solo redefine fondos/textos/líneas — los acentos siguen.

**Componentes del DS**: [`src/components/UI.jsx`](../src/components/UI.jsx)

| Componente | Uso |
|---|---|
| `<Card>` | Fondo `--bg-2` + border `--line` + radius `--radius-xl` |
| `<Btn variant="primary\|secondary\|danger\|ghost" size="sm\|md\|lg">` | Botón con CSS hover (`.btn:hover{filter:brightness(1.15)}`) |
| `<Badge color="green\|blue\|red\|...">` | Chip |
| `<Avatar nombre imgUrl>` | Avatar con fallback a iniciales coloreadas. `imgUrl` se valida (solo HTTPS) |
| `<Input label id error>` | Input con `aria-invalid` + `aria-describedby` |
| `<Select label id>` | Select con mismo estilo |
| `<Table columns data onRowClick ariaLabel>` | Tabla con keyboard nav |
| `<ProgressBar value max color>` | Barra con `role="progressbar"` |
| `<EmptyState icon title description>` | Placeholder |

### Reglas de diseño

- No uses inline `onMouseEnter/Leave` para hover. Pon `className="interactive-row"`,
  `className="nav-link"` o `className="btn"` y deja que el CSS lo gestione
  (mejor accesibilidad — `:focus-visible` funciona igual).
- No uses `outline: none` en inputs. La regla `.form-input:focus` ya cambia
  el borde a verde — `:focus-visible` global da contorno accesible.
- Modales: usa `<Modal>` (con focus trap, Escape, backdrop click) en vez de
  divs con `position: fixed`.
- Para confirmaciones: `<ConfirmDialog>` (no `window.confirm`).
- Para feedback: `useToast()` (no `alert`).
- Para inputs reutilizables: `className="form-input"` para que aplique el
  focus de la app.

---

## 8. Páginas — convención

Cada página es un componente default-export en `src/pages/`.
Patrón típico:

```jsx
export default function MiPagina() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getAlgo()
      .then(setData)
      .catch(() => toast.error('Error cargando…'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Spinner aria-label="Cargando..."/>
  return ( … )
}
```

Reglas:

- **Lazy-load** automático (declarado en `App.jsx`). No la importes
  directamente — añade el `<Route>` con `lazy(() => import(…))`.
- Si crece > ~600 LOC, considera partirla en sub-componentes en una carpeta
  hermana (`src/pages/Clients/`, `src/pages/Contabilidad/`).
- Mostrar errores con `useToast().error(…)`, no con `setError(err.message)`.
  Los mensajes raw del servidor pueden filtrar info — `userFriendlyError()`
  en `api.js` ya los mapea a strings genéricos.

---

## 9. Backend Round — endpoints relevantes

Para entender qué hace cada endpoint, mira:

- `/api/auth/usuario-web/*` → login, me, reset password, etc.
- `/api/config/*` → cuotas, descuentos, categorías, centros, plantillas email, pasarelas pago
- `/api/cuotas/*` → asignaciones, recibos, alta cliente
- `/api/clientes-atendidos/*` → log de actividad por cliente
- `/api/trainer-data/*` → datos filtrados al impersonar
- `/api/retos/snapshot` → retos y datos para Dashboard

El backend Flask vive en el VPS (`/opt/round_config_api/`, ver
[`CLAUDE.md`](../CLAUDE.md) sección Infraestructura).

---

## 10. Variables de entorno

```bash
# .env.local (no commitear, está en .gitignore)
VITE_CONFIG_API_TOKEN=<token compartido para X-Round-Token>
```

| Variable | Para |
|---|---|
| `VITE_CONFIG_API_TOKEN` | Token enviado en `X-Round-Token` a todos los `/api/*`. **Obligatoria**: sin ella, todos los endpoints del backend Round responden 401. Pídela al lead. |

Las variables `VITE_*` se inyectan en build time (`import.meta.env.VITE_*`),
no se leen runtime. Hay que reconstruir tras cambiarlas.

---

## 11. Permisos

Cada usuario_web tiene un `perfil` con secciones permitidas
(ver `src/utils/permissions.js`). El sidebar y las rutas filtran por estas
claves. Un **manager NoofitPro** (`kind: 'manager'`) **no tiene perfil**
(=`null`) y ve todo.

Catálogo en [`src/config/routes.js`](../src/config/routes.js):

```js
{ to: '/clientes', label: 'Clientes', perm: 'clientes' }
{ id: 'crm', label: 'CRM', perm: 'crm', children: [
  { to: '/crm', label: 'Leads', perm: 'crm.leads' },
  …
]}
```

Para añadir una página nueva con gating:

1. Añade el `<Route>` en `App.jsx`
2. Añade el item en `navItems` con el `perm:`
3. Define la clave de permiso en el catálogo del backend (config/perfiles)

---

## 12. Tests

```bash
npm test             # corre una sola vez
npm run test:watch   # modo watch
npm run test:coverage
```

Convención: `algo.js` → `algo.test.js`. Tests viven al lado del módulo.
Stack: **Vitest** + Testing Library + jsdom. Setup global en `src/test/setup.js`.

Áreas con tests hoy: validators, colors, formatters, UI.jsx, Toast,
ErrorBoundary, api (cache).

Cuando añadas un módulo nuevo en `utils/`, escribe su test.

---

## 13. Build y deploy

### Local

```bash
npm run dev    # http://localhost:5173 (con proxy /wiemspro + /api)
npm run build  # bundle a dist/
npm run preview
```

El proxy de dev está en [`vite.config.js`](../vite.config.js):

- `/api/*` → `https://round.wiemspro.com` (backend Round)
- `/reserva/*` → `https://round.wiemspro.com`
- `/wiemspro/*` → `https://pro.wiemspro.com` (NoofitPro)

### Producción

`https://round.wiemspro.com` es servido por nginx en el VPS (212.227.40.122).
Deploy manual — ver [`CLAUDE.md`](../CLAUDE.md) sección "Despliegues":

```bash
npm run build
scp -r dist/. round-vps:/var/www/round/
```

(necesitas el alias SSH `round-vps` configurado + clave `~/.ssh/odoo_carajfam`)

---

## 14. Gotchas / trucos

- **`X-Round-Token` faltante** → todos los `/api/*` devuelven 401 → el
  interceptor te tira al login en bucle. Comprueba que `.env.local` tiene
  `VITE_CONFIG_API_TOKEN`.
- **Login da 401 pero las credenciales son correctas**: el primer 401 (de
  `/api/auth/usuario-web/login`) es **esperado** si el usuario no existe en
  la tabla `usuario_web` — la app cae automáticamente al login NoofitPro.
  Mira la **segunda** petición en Network.
- **El bundle de `vendor` (~220KB) ya está separado**. No metas librerías
  pesadas (charts, xlsx, docx) en código que se cargue siempre — déjalas
  en su página y se lazy-loadean solas.
- **NoofitPro devuelve fechas con offset** (`yyyy-MM-ddTHH:mm:sszzz`). Usa
  los helpers de `formatters.js` y no parsees a mano.
- **MD5 en el password de NoofitPro**: es restricción del backend, no nuestra.
  La función `hashPassword` en `api.js` lo hace transparente.
- **No subas `dist/`, `.env`, `node_modules/` ni claves SSH**.
  El [`.gitignore`](../.gitignore) los cubre.
- **Cambiar el `--gradient-primary`** se hace SOLO en `index.css`. Todos los
  CTAs lo usan via `var(--gradient-primary)`.
- **Modal anidado** (popup desde dentro de otro popup): pasa `disabled={true}`
  al `<Modal>` padre mientras el hijo esté abierto, para que su Escape no lo
  cierre.

---

## 15. Onboarding — checklist primer día

- [ ] Clonar repo + `npm install`
- [ ] Pedir al lead el `.env.local` con `VITE_CONFIG_API_TOKEN`
- [ ] `npm run dev` → entrar con `roundgestion@noofit.com` / `1234abcd`
      (cuenta test del CLAUDE.md original)
- [ ] Leer `CONTRIBUTING.md` (flujo PR)
- [ ] Leer este documento
- [ ] Crear primer issue de prueba con label `feature` → comprobar que el bot
      crea la rama
- [ ] Hacer un commit de prueba con mensaje **mal formateado** y verificar
      que el hook `commit-msg` lo rechaza
- [ ] Hacer `git push origin <tu-rama>` y comprobar que el hook `pre-push`
      lanza tests + build antes
