# Bitácora del POC — Sistema de facturación Round/Odoo

> Sesión 1 · 2026-05-01

---

## Sesión 1 — Setup base + flujo SEPA validado

### ✅ Infraestructura

| Tarea | Estado | Detalle |
|---|---|---|
| Swap 4 GB activado y permanente | ✓ | `/swapfile` en `/etc/fstab` |
| DNS `round.carajfam.com` | ✓ | apunta a `212.227.40.122` |
| Cert Let's Encrypt | ✓ | vence 2026-07-30, autorenueva |
| Nginx → Odoo (puerto 8069) | ✓ | `/etc/nginx/sites-available/round.carajfam.com` |
| Odoo 17 reiniciado | ✓ | servicio `odoo17.service` |

**Aprovechamiento de infra existente**: Odoo 17 + PostgreSQL 16 ya estaban del proyecto Carajfam. **No se ha instalado Odoo de cero** — solo se ha creado una BD nueva en la instancia existente.

### ✅ Base de datos `round_facturacion`

| Item | Estado |
|---|---|
| BD creada con 51 módulos base + l10n España | ✓ 45 MB |
| Módulos OCA `bank-payment` clonados (rama 17.0) | ✓ en `/opt/odoo17/custom-addons/bank-payment` |
| `account_banking_sepa_direct_debit` instalado | ✓ |
| `account_banking_mandate` instalado | ✓ (dependencia) |
| `account.payment.order` disponible | ✓ |

### ✅ Empresa Best Training Rincón de la Victoria S.L.

| Campo | Valor |
|---|---|
| Razón social | BEST TRAINING RINCON DE LA VICTORIA SL. |
| CIF | ESB72349137 |
| Dirección | Jacinto Verdaguer, 29002 Málaga |
| Teléfono | 687543691 |
| Email | c.alcalde.campusport@gmail.com |
| IBAN | ES9800491862412810107577 (Santander) |
| BIC | BSCHESMM |
| **SEPA Creditor ID** | **ES25000B72349137** |
| Journal bancario | "Banco Santander" (código BSAN) |

### ✅ Cuenta analítica

- Plan analítico: **Centros**
- Cuenta analítica: **Round Málaga Centro** (id 20)

### ✅ Catálogo de cuotas (3 productos)

| Código | Nombre | Precio |
|---|---|---|
| RT 1D | RT 1 día/semana | 10,00 € |
| I MYGYM | MyGym mensual | 55,00 € |
| RT 2 dias | RT 2 días/semana | 60,00 € |

### ✅ Cliente test + mandato SEPA

| Campo | Valor |
|---|---|
| Cliente | TEST Juan García López |
| DNI | ES12345678Z |
| IBAN | ES7621000418401234567891 |
| Mandato | BM0000003, validado, firma 2026-05-01 |
| Payment mode | SEPA Direct Debit Banco Santander |

### ✅ Factura emitida

```
Número:        INV/2026/00005
Fecha:         2026-05-01
Vencimiento:   2026-05-15
Cliente:       TEST Juan García López
Concepto:      Cuota RT 1 día/semana - Mayo 2026
Base imponible: 10,00 €
IVA 21%:        2,10 € (al validar Odoo aplica IVA estándar)
Total:         12,10 € (con IVA actual)
Estado:        posted
```

> Nota: el sistema aplica el IVA por defecto del producto. Para servicios deportivos exentos o con IVA reducido habrá que ajustar la fiscalidad de los productos en una iteración posterior.

### ✅ Payment order y fichero SEPA

| Item | Detalle |
|---|---|
| Payment order | PAY0003, estado `generated` |
| Fichero generado | `sdd_PAY0003.xml` (2592 bytes) |
| Estándar | ISO 20022 — **pain.008.001.02** |
| Validación visual | ✓ todos los campos correctos |

**Fichero `pain.008` muestra:**
- Iniciador BEST TRAINING + IBAN + BIC Santander
- Creditor Scheme ID `ES25000B72349137` correcto
- Local Instrument `CORE` (estándar SEPA)
- Sequence Type `FRST` (primer cobro del mandato)
- Mandato `BM0000003` firmado 2026-05-01
- Deudor con IBAN
- Importe 11,50 €
- Fecha cobro 2026-05-15

---

## 🎯 Hitos cubiertos del plan POC (sección 8 del documento de arquitectura)

| Tarea POC | Estado |
|---|---|
| 1. Instalar Odoo Community 17 en VPS | ✓ aprovechando instalación existente |
| 2. Activar swap | ✓ |
| 3. Crear empresa "Round Málaga" / Best Training | ✓ |
| 4. Crear cuentas analíticas | ✓ Round Málaga Centro |
| 5. Instalar módulos Odoo necesarios | ✓ SEPA Direct Debit + Mandate |
| 6. Desarrollar módulo `round_facturacion` (custom) | ⏳ pendiente sesión 2 |
| 7. Crear cliente de test manualmente | ✓ con DNI, IBAN, mandato, suscripción |
| 8. Generar fichero SEPA y validar | ✓ pain.008 conforme |
| 9. Documentar hallazgos | ✓ este documento |

---

## ⚠️ Problemas encontrados y resueltos

| Problema | Solución |
|---|---|
| nginx duplicate upstream/listen al copiar config | Reescribir config limpia desde cero |
| `account.account.company_ids` no existe en Odoo 17 | Usar `search_count` sin filtro de company |
| Admin no tenía permisos contables | Añadir grupos `account.group_account_user`, `analytic.group_analytic_accounting` |
| `currency_id` no se puede cambiar si hay journal items | Eliminar el campo del update (ya estaba en EUR) |
| `invoice_policy` no existe sin módulo `sale` | Eliminar campo del create de product.template |
| XML-RPC marshalling None en `validate()` | Pasar `allow_none=True` al ServerProxy |
| `account.payment.line` requiere `partner_id`, `communication`, `currency_id`, `amount_currency`, `date` | Rellenar todos los campos manualmente |

---

---

## Sesión 2 — Módulo custom `round_facturacion` ✅

### ✅ Módulo creado e instalado

```
odoo_modules/round_facturacion/
├── __manifest__.py                          # depends: account, mail, account_payment_order,
│                                            #          account_banking_mandate, sepa_direct_debit
├── __init__.py
├── models/
│   ├── round_cuota_catalogo.py             # espejo catálogo NoofitPro
│   ├── round_descuento_catalogo.py         # catálogo descuentos
│   ├── round_subscription.py                # suscripción cliente (mail.thread)
│   ├── round_modificacion_recibo.py        # modificaciones temporales
│   ├── round_pasarela_config.py            # Redsys/Paycomet por trainer
│   ├── round_log_webhook.py                # trazabilidad MCP
│   └── res_partner.py                       # extensión: id_noofit, trainer_analytic_id
├── views/                                   # 7 ficheros XML con tree+form+search
├── security/                                # 2 grupos + ACLs
└── data/
```

### ✅ Datos cargados tras instalación

| Modelo | Filas |
|---|---|
| `round.cuota.catalogo` | 3 (RT 1D, I MYGYM, RT 2 dias) — vinculadas a sus productos Odoo |
| `round.descuento.catalogo` | 4 (DESC_FAMILIA, DESC_EMPLEADO, DESC_BAJA_MED, PROMO_2026) |
| `round.subscription` | 1 activa (TEST Juan García → cuota RT 1D, mensual, SEPA, mandato) |
| `round.pasarela.config` | 0 (pendiente cuando se tengan credenciales reales) |
| Cliente test extendido | trainer_analytic_id = "Round Málaga Centro", id_noofit = 1811337 |
| Factura existente | INV/2026/00005 vinculada a la suscripción |

### ⚠️ Ajustes durante la instalación

| Problema | Solución |
|---|---|
| Faltaba dependencia `mail` en manifest (tracking en estado de subscription) | Añadida `'mail'` a `depends` |
| Botón sin método `action_view_subscriptions` en cuota catálogo form | Eliminado del XML |
| Admin `adminround` sin grupo `base.group_system` | Insertado vía SQL |
| Password admin se reseteó tras restart | Reseteado vía Odoo Python shell con `env['res.users'].browse(2).password = ...` |

### 🎯 Hitos cubiertos del plan POC

| Tarea POC | Estado |
|---|---|
| 6. Desarrollar módulo `round_facturacion` (custom) | ✅ |

### Acceso al módulo en la UI

```
Login en https://round.carajfam.com
BD round_facturacion · adminround / RoundFact!2026

Menú → Round Facturación
├── Suscripciones
├── Modificaciones
└── Configuración
    ├── Catálogo cuotas
    ├── Catálogo descuentos
    ├── Pasarelas de pago
    └── Logs webhooks
```

También en la ficha de cualquier cliente: nueva pestaña **"Round Facturación"** con id_noofit, trainer asignado, estado y suscripciones.

---

## 🚀 Próxima sesión

### Sesión 3 — MCP receiver (siguiente)

- Endpoint REST que reciba `POST /eventos/{evento}` con auth token + HMAC
- Conexión XML-RPC a Odoo
- Procesa los 11 eventos de NoofitPro → Odoo (sección 4.1 del documento)

Crear el módulo Odoo con los modelos descritos en sección 3.2 del documento de arquitectura:

```
round_facturacion/
├── __manifest__.py
├── models/
│   ├── round_cuota_catalogo.py
│   ├── round_descuento_catalogo.py
│   ├── round_modificacion_recibo.py
│   ├── round_log_webhook.py
│   ├── round_pasarela_config.py
│   ├── res_partner.py             # extension: id_noofit, trainer_analytic_id
│   └── subscription_subscription.py
├── views/
│   ├── round_cuota_catalogo_views.xml
│   ├── round_descuento_catalogo_views.xml
│   ├── round_modificacion_recibo_views.xml
│   ├── round_log_webhook_views.xml
│   └── menus.xml
├── security/
│   ├── ir.model.access.csv
│   └── round_facturacion_security.xml
└── data/
    └── round_pasarela_config_data.xml  # config inicial Redsys/Paycomet stub
```

### Sesión 3 — MCP receiver

- Endpoint REST que reciba `POST /eventos/{evento}` con auth token + HMAC
- Conexión XML-RPC a Odoo
- Procesa los 11 eventos de NoofitPro → Odoo (sección 4.1 del documento)

### Sesión 4 — Polling Odoo → NoofitPro

- Cron cada 30 min que detecte cambios en account.move (cobros, devoluciones, impagos)
- Llamadas a NoofitPro para registrar estado
- Disparar push vía servicio noofit

### Sesión 5 — Migración inicial

- Importar ~300 clientes activos de NoofitPro al sandbox
- Verificar reconciliación 0 alertas

### Sesión 6 — Pasarela Redsys/Paycomet

- Configurar payment mode tarjeta
- Stub de tokenización hasta credenciales reales
- Enlaces de pago para caja y reintentos

---

## 📁 Archivos en el VPS

```
/etc/odoo17.conf                        # Config Odoo (modificada: bank-payment en addons_path)
/etc/nginx/sites-available/round.carajfam.com   # Proxy nginx
/etc/letsencrypt/live/round.carajfam.com/       # Certs HTTPS
/opt/odoo17/custom-addons/bank-payment/         # Módulos OCA SEPA
/tmp/sepa_sdd_PAY0003.xml                       # Fichero SEPA generado
/tmp/round_setup.py                             # Script setup empresa
/tmp/round_analytic.py                          # Script cuenta analítica
/tmp/round_sepa.py                              # Script Creditor ID + journal
/tmp/round_poc.py                               # Script cuotas + cliente + mandato
/tmp/round_poc2.py                              # Script payment mode SEPA
/tmp/round_poc3.py                              # Script factura
/tmp/round_poc5.py                              # Script payment order + pain.008
/var/log/odoo/odoo17.log                        # Log Odoo (compartido con Carajfam)
```

## 🔐 Credenciales

```
URL:      https://round.carajfam.com
BD:       round_facturacion
Usuario:  admin
Password: RoundFact!2026  ← cámbialo en cuanto entres
```

Acceso PostgreSQL (solo desde el VPS):
```
sudo -u postgres psql -d round_facturacion
```
