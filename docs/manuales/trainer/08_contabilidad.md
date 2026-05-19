# Manual Trainer · 8 de 12 · Contabilidad (opcional)

## Visibilidad condicional

**Solo aparece este menú si el Manager te ha activado el permiso de
contabilidad** desde Configuración → Centros → Permisos.

Si no lo ves, no tienes acceso a este módulo. Pídeselo al manager si
crees que deberías.

## Cómo llegar

Menú → **Económico ▾ → Contabilidad**.

> 📷 **Captura: `08_contab_trainer.png`** — vista de contabilidad
> filtrada a documentos de tu centro.

## Qué puedes hacer

Versión recortada del módulo de contabilidad del manager (doc 17–22):

- **📄 Documentos** — ver gastos asociados a tu centro, subir nuevos
- **🔍 Faltantes** — ver qué gastos esperaba el sistema este mes
- **📊 Totales** — pivot table con tu propio gasto

NO ves:

- ❌ El tab **🏦 Banco** (importación de extractos — solo manager)
- ❌ La **Cuenta de Resultados** consolidada del manager
- ❌ Documentos de otros centros

## Subir documentos

El flujo es idéntico al del manager (doc 18):

1. 📎 Subir documento
2. La IA escanea + extrae datos
3. Revisas + validas

**Diferencia clave**: si el CIF receptor del documento NO coincide con
el CIF de tu centro, salta **doble autorización obligatoria**:

> 📷 **Captura: `08_doble_auth_trainer.png`** — banner rojo con
> checkbox "Confirmo bajo mi responsabilidad…".

## Tips

- Solo subes los documentos cuyo **gasto corresponde a tu centro**.
  Los gastos generales del manager (gestoría, dominio web, software)
  los sube el Manager.
- Si no sabes si un documento te corresponde, no lo subas: pregunta
  al Manager primero.
- Los documentos **validados** crean asiento Odoo en `account.move`
  (estado `draft`); el Manager los postea.
