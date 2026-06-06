# Manager y Trainer — modelo de identidad y scope

> Documento de referencia. **Toda nueva funcionalidad debe respetar estas reglas.**
> Si una decisión de diseño las contradice, hay que justificarlo aquí antes de
> implementarla.

---

## 1. Conceptos

### 1.1 La jerarquía la decide NoofitPro

Round **no** define quién es manager ni quién es trainer. Lo hereda de NoofitPro:

- Cada cuenta NoofitPro tiene un `id` numérico (`account/loginEasy` lo devuelve).
- Esa cuenta puede actuar como **manager** o como **trainer** según los permisos
  que tenga **dentro de NoofitPro**.
- En Round Config replicamos esa jerarquía mediante dos columnas:
  - `id_manager`: id NoofitPro del manager bajo cuyo paraguas vive el dato
  - `id_trainer`: id NoofitPro del trainer concreto (puede ser igual al
    `id_manager` cuando el dato vive a nivel manager-de-su-propio-trainer)

### 1.2 Manager

- Una cuenta NoofitPro con **rol superior**. Tiene **privilegios sobre sus
  trainers**.
- En Round Config: fila en `manager_config(id_manager)` con sus flags Odoo
  (`odoo_crm_enabled`, `odoo_cuotas_enabled`, `odoo_contabilidad_enabled`),
  flag `control_horario_enabled`, `sistemas_cobro`, etc.
- El `manager_config.odoo_company_id` apunta a la `res.company` en Odoo. Dos
  managers **pueden compartir** la misma `res.company` si son la **misma
  entidad jurídica** (mismo CIF/razón social). En ese caso comparten
  contabilidad legal pero mantienen analíticas separadas vía
  `account.analytic.account`.

### 1.3 Trainer

- Una cuenta NoofitPro **subordinada** a un manager. Es un "centro" físico u
  organizativo dentro del paraguas del manager.
- Dueño funcional de los clientes que se le adscriben y de sus catálogos
  trainer-scope.
- En Round Config: aparece como `(id_manager, id_trainer)` en las tablas con
  scope-per-trainer. **No** existe tabla `trainer` aparte; es información
  derivada del par.

### 1.4 Usuario_web

- Persona física que entra a la web Round (`usuario_web` table).
- Cada `usuario_web` está vinculado a un `(id_manager, id_trainer)`:
  - `id_trainer = NULL`: opera como **manager bare** (ve TODO el manager).
  - `id_trainer != NULL`: vinculado a un centro concreto (ve solo lo de ese
    trainer + plantillas del manager).
- `perfil_is_admin = TRUE` permite usar el **selector global "Centro"** del
  header para impersonar cualquier trainer del manager.

---

## 2. Reglas funcionales (las que NUNCA se rompen)

### Regla 1. La jerarquía es decisión de NoofitPro

Round Config **nunca** crea managers ni trainers por su cuenta. Solo replica.
La creación pasa por:

1. Alguien crea la cuenta en NoofitPro.
2. La cuenta hace login en Round.
3. `auth_bootstrap` (`/api/auth/round-bootstrap`) registra la fila en
   `manager_config` la primera vez que aparece.

### Regla 2. Manager y trainer pueden NO ser la misma entidad jurídica

- La sociedad jurídica vive en Odoo (`res.company`).
- Dos managers/trainers pueden:
  - **Compartir company** (misma S.L. con CIF único) → secuencia de facturas
    única, mismas obligaciones SII/AEAT, P&L separable solo por analítica.
  - **Tener company propia** → secuencias separadas, P&L total separado.

### Regla 3. Privilegios — herencia manager → trainer

> **Si el manager tiene derecho a un módulo, sus trainers también lo tienen.**

- `manager_config.odoo_crm_enabled = TRUE` → todos los trainers de ese manager
  ven el CRM.
- Igual para `odoo_cuotas_enabled`, `odoo_contabilidad_enabled`,
  `control_horario_enabled`.
- No existe (y **no debe existir**) un flag de "este trainer no tiene CRM" si
  el manager lo tiene. El manager decide los módulos, no el trainer.
- A nivel granular cabe configurar **comportamiento** per-trainer
  (ej. `trainer_odoo_config.heredar_contabilidad` decide si comparte la
  cuenta analítica o tiene una propia), pero **nunca habilita/deshabilita** el
  módulo en sí.

El backend lo enforza con `@require_feature('crm'|'cuotas'|'contabilidad'|'control_horario')`
que consulta solo `manager_config[id_manager]`. No mira el trainer.

### Regla 4. Datos de clientes y cuotas NUNCA se mezclan entre managers

- Cada cliente vive en `cliente_cache` etiquetado con `(id_manager, id_trainer)`.
  Un mismo cliente NoofitPro puede aparecer en varias filas si vario managers
  lo tienen, pero **cada fila es independiente**.
- Cada cuota vive en `cuota` etiquetada con `(id_manager, id_trainer)`. Lo
  mismo para `descuento`, `modificacion`, `cuota_cliente`.
- Las queries de listado **deben** filtrar por `id_manager = g.id_manager`
  **siempre**.
- El selector global del header (`X-Round-Trainer-Id`) puede acotar **dentro
  del manager**, nunca cruzarlo.

### Regla 5. Datos del manager SÍ se comparten entre sus trainers

- **Plantillas** (`scope='plantilla_manager'`) en `cuota`, `descuento` —
  visibles para cualquier trainer del manager. Cada trainer puede "adoptarlas"
  o crear las suyas.
- **Categorías de cliente** (`categoria`) — manager-wide.
- **Convenios laborales** (`convenio`) — manager-wide.
- **Motivos de pausa** (`pausa_motivo`) — manager-wide con globales
  heredables.
- **Email templates** de eventos CRM (`email_template`) — manager-wide.
- **Email proveedor** y **Pasarela de pago** — **per-trainer** con fallback
  manager.

### Regla 6. Aislamiento per-trainer

- **Clientes** (`cliente_cache`) — per-trainer (un cliente pertenece a un solo
  trainer dentro del manager).
- **Cuotas y descuentos** con `scope='trainer'` — solo del trainer que las
  creó.
- **Asignaciones** (`cuota_cliente`, `descuento_asignacion`) — heredan el
  trainer del cliente.
- **TPV** (`pos_producto`, `pos_categoria`) — per-trainer (cada centro su
  catálogo).
- **Trabajadores y fichajes** (`trabajador`, `fichaje_evento`) —
  per-trainer-empleador.

---

## 3. Tabla por tabla

### 3.1 Tablas manager-wide (compartidas entre trainers)

| Tabla | Comentario |
|---|---|
| `manager_config` | UNA fila por manager. Flags Odoo, sistemas_cobro. |
| `categoria` + `cliente_categoria` | Categorías comunes del manager. |
| `convenio` | Catálogo manager (+ filas globales sembradas). |
| `pausa_motivo` | Manager + globales del sistema. |
| `email_template` | Por (id_manager, evento, destinatario). |
| `social_cuenta`, `social_post` | Manager. |
| `notif_envio` | Manager (puede targetar trainers o clientes). |
| `cuota` / `descuento` con `scope='plantilla_manager'` | Plantillas del manager para todos sus trainers. |

### 3.2 Tablas per-trainer (aisladas)

| Tabla | Scope | Comentario |
|---|---|---|
| `cliente_cache` | `(id_manager, id_trainer)` | Espejo NoofitPro. |
| `cuota` con `scope='trainer'` | `(id_manager, id_trainer)` | Catálogo del centro. |
| `descuento` con `scope='trainer'` | igual | igual |
| `cuota_cliente`, `modificacion`, `modificacion_cobro` | `(id_manager, id_trainer)` | Asignaciones. |
| `descuento_asignacion` | `(id_manager, id_trainer)` | Asignaciones. |
| `lead_asignacion` | `(id_manager, id_trainer)` | Leads CRM. |
| `slot_reserva` | `(id_manager, id_trainer)` | Pruebas gratuitas. |
| `centro_contacto` | `(id_manager, id_trainer)` | Datos del centro. |
| `pasarela_credenciales` | `(id_manager, id_trainer)` | PayComet. |
| `email_proveedor` | `(id_manager, id_trainer NULL=manager)` | Resend/SMTP. |
| `pos_producto`, `pos_categoria`, `pos_descuento`, `pos_venta` | `(id_manager, id_trainer)` | TPV. |
| `trabajador`, `fichaje_evento`, `solicitud_ausencia` | `(id_manager, id_trainer_empleador)` | Control horario. |
| `trainer_empresa` | `(id_manager, id_trainer)` | Datos jurídicos del trainer. |
| `trainer_odoo_config` | `(id_manager, id_trainer)` | `heredar_contabilidad`, analytic. |
| `trainer_contab_config` | `(id_manager, id_trainer)` | Flag `activo` (separable per-trainer). |
| `trainer_noofit_creds` | `(id_manager, id_trainer)` | Login NoofitPro per-trainer. |

### 3.3 Tablas de relaciones / pivotes

| Tabla | Comentario |
|---|---|
| `usuario_web` | Persona con `(id_manager, id_trainer NULL)`. |
| `usuario_web_trainer` | Multi-centro: usuario_web puede acceder a N trainers. |
| `trabajador_trainer` | Trabajador puede fichar en N trainers del mismo manager. |

---

## 4. Cómo se traducen al request

### 4.1 Identidad en el frontend

`getRoundIdentity(user)` devuelve `{managerId, trainerId}`:

- **usuario_web manager bare** (sin trainer asignado): `{managerId: X, trainerId: null}`.
  Ve TODO el manager.
- **usuario_web con trainer**: `{managerId: X, trainerId: Y}`. Ve solo Y +
  plantillas manager.
- **Manager NoofitPro directo** (poco común en producción): igual que manager
  bare.

### 4.2 Headers HTTP

Cada llamada a `/api/*` lleva:

- `X-Round-Token: <token compartido>` — autenticación base.
- `X-Round-Manager-Id: <id>` — siempre obligatorio.
- `X-Round-Trainer-Id: <id>` — opcional. Si está, acota al trainer. Para
  admins, el selector global del header puede sobrescribir el trainer del
  usuario.
- `Authorization: Bearer <jwt>` — para endpoints que requieren `usuario_web`.

### 4.3 Identidad en el backend

`@auth_required` rellena `g.id_manager` y `g.id_trainer`:

- De los headers, si la auth es por token compartido.
- Del JWT del `usuario_web`, si está autenticado por bearer.
- Los endpoints **deben** filtrar por `g.id_manager` siempre y por `g.id_trainer`
  cuando el dato sea per-trainer.

---

## 5. Reglas para nuevas funcionalidades

> Toda **nueva tabla** debe declarar explícitamente su scope.

| Pregunta | Decisión |
|---|---|
| ¿Es información del manager (regla, plantilla, configuración global)? | Tabla manager-wide. Key: `(id_manager)`. |
| ¿Es información del centro (cliente, venta, fichaje, lead)? | Tabla per-trainer. Key: `(id_manager, id_trainer)`. |
| ¿Está habilitado por un módulo Odoo (CRM/Cuotas/Contabilidad)? | Decorar el endpoint con `@require_feature(...)`. |
| ¿Se puede ver desde el header del usuario sin ese módulo? | NO. La UI debe esconder la tab si `features.<módulo> = false`. |

### Anti-patterns prohibidos

1. ❌ **No** crear un flag "trainer.crm_enabled" o similar para deshabilitar
   un módulo en un trainer cuando el manager lo tiene. El manager decide.
2. ❌ **No** hacer `SELECT * FROM cuota` sin `WHERE id_manager = %s`. Cualquier
   query que no filtre por manager se considera un **leak de datos cross-
   tenant** y debe rechazarse en code review.
3. ❌ **No** copiar datos de clientes/cuotas/recibos entre managers
   automáticamente. La copia entre managers es solo manualmente y bajo
   confirmación humana (caso típico: alta nueva tras refactor).
4. ❌ **No** permitir que un `usuario_web` opere fuera de su `id_manager`. Si
   alguien con manager A logra acceder a datos de manager B, es un bug crítico.

### Ejemplo correcto: añadir una nueva tabla

```sql
CREATE TABLE recompensa_referido (
  id            SERIAL PRIMARY KEY,
  id_manager    VARCHAR(64) NOT NULL,           -- siempre
  id_trainer    VARCHAR(64) NOT NULL,           -- per-trainer (referidos del centro)
  cliente_idnoofit VARCHAR(64) NOT NULL,
  importe       NUMERIC(10,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_recompensa_mt ON recompensa_referido(id_manager, id_trainer);
```

Y el endpoint:

```python
@bp.route('/recompensas', methods=['GET'])
@auth_required
@require_feature('crm')           # decide el manager
def listar():
    with get_conn() as conn, conn.cursor() as cur:
        if g.id_trainer:
            cur.execute("""SELECT … FROM recompensa_referido
                            WHERE id_manager=%s AND id_trainer=%s""",
                        (g.id_manager, g.id_trainer))
        else:
            cur.execute("""SELECT … FROM recompensa_referido
                            WHERE id_manager=%s""", (g.id_manager,))
        return jsonify({'ok': True, 'items': [dict(r) for r in cur.fetchall()]})
```

---

## 6. Casos reales documentados

### 6.1 Round (Manager A) con dos trainers misma sociedad

Configuración real Round Málaga / Round Añoreta:

- `manager_config[17675]` (Round Málaga) — `odoo_company_id = 3`
- `manager_config[17674]` (Round Añoreta) — `odoo_company_id = 3` **(misma)**
- Una sola `res.company` Odoo (BEST TRAINING RINCON DE LA VICTORIA SL — CIF
  único, secuencia de facturas única).
- Dos cuentas analíticas: `GENERAL Round Málaga` (id=15) y
  `GENERAL Round Añoreta` (id=30) — separan P&L por centro.
- Cada uno tiene su `cliente_cache` independiente.
- Cada uno tiene su catálogo de cuotas/descuentos independiente
  (`scope='trainer'` con `id_trainer=id_manager`).
- Catálogo del manager (`scope='plantilla_manager'`) sirve como base que cada
  trainer puede adoptar.

### 6.2 Multi-trainer en un manager (modelo clásico Round)

- `manager_config[7673]` (NoofitPro pro raíz) — flags Odoo activados.
- Trainers `17674`, `17675`, `17676`, `17677` colgados de él en NoofitPro.
- En Round, cada cuenta de trainer NoofitPro genera su propio `manager_config`
  cuando entra por primera vez (porque NoofitPro la identifica como manager-
  de-sí-mismo). **Esto es por diseño de NoofitPro**, no por elección Round.
- El "manager raíz" Round 7673 NO se usa para login web; cada trainer entra
  con su cuenta y opera como manager-de-su-trainer.

---

## 7. Checklist para PRs

Antes de mergear cualquier cambio que toque datos de clientes/cuotas/centros:

- [ ] ¿Las nuevas queries filtran por `g.id_manager`?
- [ ] ¿Las nuevas tablas tienen `id_manager` (y `id_trainer` si aplica)?
- [ ] ¿Los nuevos endpoints declaran `@require_feature(...)` si dependen de
      un módulo Odoo?
- [ ] ¿La UI del manager bare ve toda la data del manager? ¿Y un usuario_web
      con trainer ve solo lo suyo?
- [ ] ¿Algún paso copia datos entre managers? Si sí, ¿está documentado y bajo
      confirmación humana?
- [ ] ¿El selector global del header (impersonación) acota correctamente
      dentro del manager y no permite cruzar?
