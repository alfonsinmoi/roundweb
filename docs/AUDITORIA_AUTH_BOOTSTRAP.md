# Auditoría — Auth & bootstrap multi-tenant (jun 2026)

> Auditoría **solo lectura** (no se cambió código). Ficheros revisados:
> `app/auth.py`, `app/routes/auth_bootstrap.py`, `app/auth_usuario.py`,
> `app/auth_trabajador.py`, `app/noofit_client.py`.

## Regla de oro (confirmada, inviolable)

**El rol y la identidad de un manager/trainer los decide NoofitPro, NO la web.**
- `loginEasy` de NoofitPro devuelve la cabecera **`X-TRAINER_MANAGER`**:
  `"true"` = **MANAGER**, `"false"` = **TRAINER**.
- La web (frontend) solo **relé** ese valor; nunca lo inventa.
- El **tenant** (`id_manager` Round) NO viene del frontend: se resuelve en
  `trainer_noofit_creds` (prefiriendo el manager padre), no del body.

## Cómo se identifica un manager — flujo completo

### 1) En el LOGIN (vía NoofitPro — autoritativo)
1. El usuario hace login NoofitPro (`account/loginEasy`).
   - `noofit_client._login()` devuelve `(token, manager)` donde
     `manager = X-TRAINER_MANAGER` (`"true"`/`"false"`).
2. El frontend llama a `POST /api/auth/round-bootstrap` (fire-and-forget).
3. El backend **re-valida la contraseña contra NoofitPro**
   (`credenciales_validas → _login`, loginEasy 200) y resuelve:
   - **TENANT**: `_tenant_desde_creds(id_user)` (de `trainer_noofit_creds`);
     si es trainer de otro manager → se **reconduce** al manager padre.
   - **ROL**: `es_manager` (manager `true` → `id_trainer=None`, ve todo el
     grupo; trainer `false` → `id_trainer=id_user`, scopeado a su centro).
   - Solo un **manager dueño del tenant** crea/actualiza `manager_config`.
     Un trainer NUNCA crea `manager_config`. Anti-fantasma del trainer
     desconocido: `_tenant_via_hermanos` (grupo NoofitPro) o rechazo
     (`trainer_sin_manager`) — cierra el incidente 16702.
   - La contraseña NoofitPro solo se cachea si NoofitPro la valida (COALESCE).

### 2) En CADA PETICIÓN posterior (ya logueado)
- Cabeceras: **`X-Round-Token`** (token compartido) + **`X-Round-Manager-Id`**
  (id del tenant) [+ **`X-Round-Trainer-Id`** opcional].
- `auth_required` (`auth.py`):
  - Valida `X-Round-Token == CONFIG_API_TOKEN`.
  - `g.id_manager` = `X-Round-Manager-Id`; `g.id_trainer` = `X-Round-Trainer-Id`.
  - Valida que ambos sean numéricos (`regex \d{1,16}` → cierra path traversal).
  - `_remap_trainer_as_manager()`: si el id recibido no tiene `manager_config`
    pero es trainer de otro manager → reconduce a `id_manager=<padre>` + trainer.
- **Dos tipos de sesión:**
  - **Manager NoofitPro "clásico"** (sin JWT): `g.perfil = None` →
    `require_permission` lo deja pasar (control total). Su identidad de tenant
    es **lo que diga `X-Round-Manager-Id`** (ver H1).
  - **usuario_web** (con `Authorization: Bearer <JWT>`): `_load_usuario_web_from_jwt`
    carga `g.usuario_web` + `g.perfil` y **fija `g.id_manager` desde la BD**
    (no de la cabecera) + `g.id_trainer` del claim `trn`. → permisos finos.

## Hallazgos

### 🔴 H1 (abierto) — Identificación per-request del manager por cabecera
- Tras el login, la sesión del **manager NoofitPro no usa JWT propio**: cada
  petición se identifica solo con `X-Round-Token` + `X-Round-Manager-Id`, **sin
  re-verificar contra NoofitPro**.
- El token compartido va **dentro del bundle web** (`VITE_CONFIG_API_TOKEN` =
  `CONFIG_API_TOKEN`, 64 chars) → no es secreto para quien abre la web.
- **Riesgo:** un usuario ya logueado podría cambiar a mano `X-Round-Manager-Id`
  a otro tenant y operar como ese manager (`perfil=None` salta `require_permission`).
  No suplanta el *login* de NoofitPro; se salta la comprobación porque **después
  del login no se vuelve a verificar quién es**.
- **No afecta** a la ruta `usuario_web` (JWT) — ahí `g.id_manager` sale de la BD.
- **Recomendación:** emitir un **JWT propio firmado por el backend para el manager
  NoofitPro** tras el login (con el `id_manager` verificado), y dejar de confiar
  en la cabecera para esa ruta. Cambio grande (toca modelo auth + frontend) →
  pendiente de planificar. NO implementado.

### 🟡 H2 (retirado como riesgo; hardening trivial opcional)
- El rol **sí viene de NoofitPro** (correcto). Único matiz: `credenciales_validas`
  hace su propio `loginEasy` pero **descarta** el flag (`tok, _ = _login(...)`),
  y el bootstrap usa el `es_manager` que **reenvía el frontend** en el body.
- En el flujo honesto es el mismo valor de NoofitPro. Endurecimiento opcional:
  que `credenciales_validas` devuelva el flag y el bootstrap use **ese** (ya lo
  tiene a mano) en vez del reenviado. Prioridad baja.

### 🟢 Sólido (verificado, sin cambios)
- **JWT** (usuario_web / trabajador / cliente): `HS256` fijado
  (`algorithms=[JWT_ALGO]` → sin alg-confusion ni `none`), `exp` validado
  (168h), `bcrypt` rounds=12, `JWT_SECRET` = 64 chars.
- **Separación por `kind`**: cada decoder valida el `kind` → un token de un tipo
  no sirve en endpoints de otro.
- **Validación numérica** de `id_manager`/`id_trainer` (`\d{1,16}`).
- **Anti-fantasma** del trainer honesto (`false`): hermanos NoofitPro + rechazo
  si no pertenece a un manager Round.
- **Caché de password** solo si NoofitPro valida (COALESCE) — correcto.

## Estado
Solo lectura. Sin cambios de código. H1 queda como hallazgo a planificar;
H2 retirado (a lo sumo hardening menor opcional).
