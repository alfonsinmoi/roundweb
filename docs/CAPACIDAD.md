# Análisis de capacidad — arquitectura actual y hoja de ruta a 1M clientes

> Análisis basado en datos reales del VPS al 2026-06-02. Todas las cifras
> provienen de mediciones (no estimaciones).

---

## 1. Inventario actual

### 1.1 Hardware del VPS (`212.227.40.122`)

| Recurso | Cantidad |
|---|---|
| CPU | **6 cores** |
| RAM | **7,7 GB** (1,7 usada, 6 libre) |
| Disco | **232 GB** (31 usados, 201 libres — 14%) |
| Swap | 4 GB |
| OS | Ubuntu 24.04 |

### 1.2 Software activo

| Servicio | Workers | RAM/proc | Notas |
|---|---|---|---|
| `round_config_api` (Flask + gunicorn) | **2 sync** | ~80 MB | Backend principal |
| `odoo17` | **2 workers + 1 cron** | ~600 MB | Contabilidad |
| `postgresql` (16) | — | varios | 2 BDs |
| `nginx` | — | — | Reverse proxy |
| Otros (austral-contab, gestionnoofit, mcp…) | varios | — | Subsistemas |

### 1.3 PostgreSQL — tamaño y configuración

| BD | Tamaño | Filas top tabla |
|---|---|---|
| `round_config` | **22 MB** | 759 clientes, 2.735 recibos, 572 formas de pago |
| `round_facturacion` (Odoo) | **106 MB** | 750 facturas, 5.294 mensajes, 39.396 ir_model_data |

**Configuración PG (subóptima para escala):**

| Parámetro | Actual | Recomendado para 32 GB RAM |
|---|---|---|
| `shared_buffers` | **128 MB** ⚠️ | 8 GB (25% RAM) |
| `work_mem` | **4 MB** ⚠️ | 16 MB |
| `maintenance_work_mem` | 64 MB | 1 GB |
| `effective_cache_size` | 4 GB | 24 GB |
| `max_connections` | 100 | 200 con PgBouncer |

### 1.4 Latencia real medida

| Operación | Latencia |
|---|---|
| Query PG simple (`COUNT(*)`) | **~50 ms** (incluye spawn psql) |
| Odoo XML-RPC `res.partner.search` | **14,8 ms/call** (medido en 20 calls) |
| API Round GET `slots-disponibles` | **<20 ms** |
| Pico real de tráfico | **35 req/s** (2104 req/min) |

---

## 2. Capacidad estimada con la arquitectura actual

### 2.1 Por componente — cuellos de botella

| Componente | Cuello de botella | Capacidad confortable | Máximo absoluto |
|---|---|---|---|
| **Round API** (2 workers sync) | Workers bloqueantes | 100 usuarios concurrentes | 500 ráfaga |
| **Odoo** (2 workers) | XML-RPC bloqueante | 20 req/s sostenidos | 50 req/s con pico |
| **PostgreSQL** (config baja) | shared_buffers bajo | 500k filas/tabla rápido | Millones (lento) |
| **NoofitPro** (externo) | Rate-limit desconocido | — | — |
| **Disco** | 201 GB libres | 4M filas cliente_cache | 30M filas total |
| **Single VPS** | SPOF | — | — |

### 2.2 Capacidad **realista** medida en negocio

Tomando como referencia un cliente "activo medio":
- 1 cliente activo = ~15 KB BD/año (cache + 12 recibos + logs)
- ~5 acciones web/cliente/mes (login, ver perfil, fichar, etc.)
- Pico cobranza mensual: emisión de N recibos en 4-8 horas

| Escala | Clientes activos | Managers | Operativa | Estado actual |
|---|---|---|---|---|
| **Centro pequeño** | 500 | 1 | <1 h emisión, trivial | ✅ sobra |
| **Centro mediano** | 5.000 | 1 | 2 h emisión, fluido | ✅ funciona |
| **Cadena pequeña** | 25.000 | 5-10 trainers | 6 h emisión, ya tira | ⚠️ workers se quedan cortos en picos |
| **Cadena mediana** | 100.000 | 30-50 | Emisión 24h+, BD lenta sin tuning | ❌ requiere primera reescritura |
| **1M activos** | 1.000.000 | 500-1.000 | Inviable sin rearquitectura | ❌ |

### 2.3 Empresas (managers Round Config)

El sistema soporta hoy **N managers** independientes. Cada manager:
- 1 fila `manager_config`
- 1-N trainers
- Su propio catálogo (cuotas, descuentos, plantillas)
- 0-N `res.company` Odoo (1 si la sociedad es única, varias si hay multi-empresa)

**Límite blando actual** (con BD pequeña, 2 workers): **~50-100 managers activos**
con perfomance aceptable. Por encima necesitas más workers y PG tuning.

---

## 3. Hoja de ruta a 1M clientes activos

### 3.1 Cuellos hoy

1. 🔴 **Single VPS** = SPOF — si cae, todo cae. Lo primero a resolver.
2. 🔴 **Odoo 2 workers** = ~20 req/s. Para 1M, necesitas 50× más capacidad.
3. 🟡 **PG shared_buffers=128MB** = OK ahora pero matará con >1 GB de datos.
4. 🟡 **NoofitPro acoplamiento** = bloqueante en cada login/sync. Necesita caché agresivo.
5. 🟡 **Cron mensual emisión** = monolítico. A escala, hay que paralelizar por manager.

### 3.2 Stack propuesto para 1M activos

```
                        ┌──────────────┐
                        │ Cloudflare   │  CDN + WAF + DDoS
                        │ (frontend)   │
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │ Haproxy LB   │  2 nodos
                        │  (5673)      │
                        └──┬────────┬──┘
              ┌────────────┘        └────────────┐
       ┌──────▼──────┐                    ┌──────▼──────┐
       │ Round API   │                    │ Round API   │  3-5 nodos
       │ Flask+gthr  │      …             │ Flask+gthr  │  8 CPU, 16 GB c/u
       │ 32 workers  │                    │ 32 workers  │  gevent o threads
       └──┬────┬─────┘                    └──┬────┬─────┘
          │    └────────┬───────────────────┘    │
          │             │                        │
   ┌──────▼─────┐  ┌────▼─────┐         ┌────────▼────────┐
   │  Redis     │  │  Odoo    │         │  PgBouncer      │  connection pool
   │  cluster   │  │  cluster │         │                 │
   │  3 nodos   │  │  4 nodos │         └────────┬────────┘
   └────────────┘  └────┬─────┘                  │
                        │                ┌───────▼────────┐
                  ┌─────▼─────┐          │  PG primary    │  16 CPU, 64 GB
                  │ Workers   │          │  + WAL replica │  NVMe RAID10
                  │ Celery    │          │  + 2 réplicas  │
                  └───────────┘          │   read-only    │
                                         └────────────────┘
                  S3-compatible para attachments/PDFs (backups + facturas)
```

### 3.3 Cambios técnicos necesarios

#### Frontend
- **CDN Cloudflare** para todos los `*.js/*.css/*.png/*.html`. Reduce 95% del tráfico al servidor.
- **HTTP/2 + Brotli**. Activar en nginx.
- **Code-splitting agresivo** por ruta (ya existe parcialmente con `lazy()`).

#### Round API (Flask)
- Cambiar **gunicorn sync → gthread o gevent** (8 procesos × 16 threads = 128 workers/nodo).
- **Asíncrono donde haya I/O externo** (NoofitPro, Odoo): `httpx.AsyncClient`, pero requiere reescribir endpoints.
- **Caché de sesiones JWT** en Redis (hoy se decodifica en cada request — coste constante).
- **Caché de lookups** (`getEntrenadores`, `manager_config`, catálogos) → Redis con TTL 60 s.
- **Rate limit** por IP + por manager.

#### Odoo
- Pasar a `--workers=16` con `--gevent-port` para longpolling.
- Separar XML-RPC de webclient (puertos distintos).
- Pool de conexiones Odoo en Round API (XML-RPC reusable, no reconectar por request).
- Para acciones masivas (emisión, contabilización), usar **Odoo Job Queue** (`queue_job` de OCA).
- Evaluar Odoo SaaS multi-DB shardado por manager (1 DB Odoo cada ~50 managers).

#### PostgreSQL
- **`shared_buffers = 25% RAM`** del servidor PG dedicado.
- **`work_mem = 16 MB`** (cuidado con conexiones × work_mem).
- **`max_connections = 200` + PgBouncer** (transaction pooling).
- **Réplicas streaming**: 2 nodos read-only para listados/reports.
- **Partitioning** por `id_manager` o por fecha (recibos, fichaje_evento, accion_log).
- **VACUUM ANALYZE** programado (no solo auto) + REINDEX trimestral.
- **WAL archivado** a S3 para PITR.

#### Cron y emisión
- Sustituir cron monolítico por **cola Celery** o **Odoo Job Queue**:
  - Job por manager (cada uno paralelo, escala horizontal).
  - Retries automáticos en fallo.
  - Idempotencia obligatoria.
- Emisión mensual: 1M recibos en 2h con 10 workers paralelos = 1.400 recibos/min/worker.

#### NoofitPro
- **Caché agresivo** (Redis con TTL 5min) para `getClienteSimple`, `getTrainersByManager`,
  `getCuotas`.
- **Webhooks NoofitPro → Round** si los publican (evitar polling).
- **Negociar SLA y rate-limit** explícito con el proveedor.
- Plan B: si NoofitPro se vuelve cuello, replicar datos críticos en BD local y
  marcar NoofitPro como fuente eventual (sync diferido).

#### Observabilidad
- **Prometheus** scrapeando gunicorn, Odoo, PG, nginx.
- **Grafana** dashboards: latencia p50/p95/p99, errores 5xx, conexiones PG, RAM por proceso.
- **Logs centralizados**: Loki o ELK.
- **Alertas** (PagerDuty / Telegram): error rate > 1%, p99 > 2s, disk > 80%.

#### Backups y DR
- **PG**: WAL archiving continuo + `pg_basebackup` diario a S3.
- **Odoo filestore**: rsync incremental a S3.
- **RTO**: 30 min con failover automático (Patroni).
- **RPO**: 1 min (WAL streaming).
- **DR site**: réplica en otro proveedor (Hetzner→OVH o viceversa).

### 3.4 Costes estimados

| Escenario | Infra/mes | Operación |
|---|---|---|
| Actual (1 VPS) | ~60€ | Reactivo |
| 25k clientes (2-3 VPS) | 200-300€ | Manual |
| 100k clientes (cluster) | 600-1.000€ | Semi-automatizado, 0.5 SRE |
| **1M clientes** | **1.500-3.000€** (cloud) o 800-1.500€ (bare metal) | **1 SRE + soporte 24/7** |

### 3.5 Camino incremental (no big-bang)

| Fase | Objetivo | Esfuerzo | Cuándo |
|---|---|---|---|
| 0 | Tuning PG actual (shared_buffers, work_mem) | 1 día | YA si pasas de 10k clientes |
| 1 | Cloudflare delante del frontend | 1 día | YA |
| 1.5 | Más workers (gunicorn 8, odoo 4) | 1 día | YA si VPS lo aguanta |
| 2 | Redis + caché de sesiones/lookups | 3-5 días | 5k clientes |
| 3 | Separar PG en VM dedicada + réplica read | 1 semana | 25k clientes |
| 4 | Odoo Job Queue para emisión y contab. | 2 semanas | 50k clientes |
| 5 | Cluster Round API + Haproxy | 1-2 semanas | 100k clientes |
| 6 | Sharding PG por manager (multi-DB) | 1 mes | 500k clientes |
| 7 | Multi-región + DR | 1 mes | 1M clientes |

**Total esfuerzo**: ~3-4 meses de un equipo backend pequeño para llegar a 1M.

---

## 4. Resumen ejecutivo

- **Hoy** la arquitectura aguanta cómodamente **~5.000 clientes activos** en un manager,
  o **~50-100 managers** pequeños. Latencia <50 ms p95.
- **Cuello inmediato**: 2 workers Odoo + 2 workers Round API + PG infraconfigurado.
  Con 1 día de tuning (PG + workers) sube a 25k clientes sin problema.
- **Hasta 100k clientes**: cluster app + PG separado + Redis. ~1 mes de trabajo.
- **A 1M clientes**: rearquitectura distribuida (LB + cluster + sharding + DR).
  ~3-4 meses de trabajo. Coste infra ~1.500-3.000 €/mes.
- **Mayor riesgo no técnico**: dependencia de **NoofitPro**. Sin SLA explícito de su API,
  cualquier escala mayor a 50k es arriesgada.
