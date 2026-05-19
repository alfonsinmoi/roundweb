# Manual Manager · 30 de 38 · Configuración — Menú general

## Cómo llegar

Menú lateral → **⚙ Configuración**.

> 📷 **Captura: `30_config_menu.png`** — pantalla con tabs de
> configuración.

## Tabs disponibles

| Tab | Doc |
|---|---|
| Centros / Trainers | 31 |
| Cuotas y Descuentos | 32 |
| Email (proveedores + plantillas) | 33 |
| Pasarelas de pago (PayComet) | 34 |
| Notificaciones (OneSignal) | 35 |
| Categorías cliente | 36 |
| Catálogos (modificaciones, motivos baja…) | 37 |
| Meta (Instagram + Facebook) | 38 |

## Quién puede tocar qué

- **Manager**: todo
- **Trainer**: solo su propia ficha de centro y sus credenciales de
  pasarela / email (si el manager le da permisos)

## Tips

- La configuración es **per centro** (multi-tenant): cada trainer
  tiene su Resend, su PayComet, su Meta, su email firma…
- El manager hereda la config "por defecto"; los centros pueden
  sobrescribir.
- Tras cualquier cambio, **probar inmediatamente** con un envío
  manual (push de prueba, recibo de prueba…) antes de que entre
  producción.
