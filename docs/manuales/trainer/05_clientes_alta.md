# Manual Trainer · 5 de 12 · Alta de Cliente

## Cómo llegar

Menú → **👥 Clientes** → botón **"➕ Nuevo cliente"**.

> 📷 **Captura: `05_alta_cliente_trainer_form.png`** — formulario de
> alta.

## Qué hace

Da de alta un cliente **directamente asignado a tu centro** (no puedes
asignarlo a otro trainer; lo hace el Manager).

## Formulario

1. **Datos personales**: nombre, apellidos, email, teléfono, DNI,
   fecha nacimiento, género, dirección
2. **Cuota**: selecciona del catálogo (solo las activas)
3. **Periodicidad**: mensual / trimestral / único
4. **Descuento**: opcional (del catálogo)
5. **Modificación**: cargo extra puntual (matrícula…)
6. **Forma de pago**: SEPA (con IBAN) / TPV / link PayComet
7. **Origen**: ¿de dónde viene? (Instagram, Google, recomendación, lead
   CRM…)

## Validaciones automáticas

- DNI / NIE / Pasaporte válido
- Email RFC válido (rechaza `_MAK` y otros markers de sandbox)
- IBAN válido si forma de pago = SEPA

## Tras dar al alta

1. Se crea cliente en NoofitPro (con `toSend=False` para no mandarle
   email Wiemspro)
2. Se reserva en sala (si aplica)
3. Se crea cliente en Odoo (`res.partner`)
4. Se crea suscripción (`subscription`) con anti-duplicado
5. Se emite el primer recibo
6. Se cobra (SEPA / TPV / link, según forma)
7. Si venía de **lead** del CRM, se mueve el lead a etapa "Alta"

## Tips

- Si el cliente ya existe en NoofitPro (por DNI), Round lo **reutiliza**;
  no se duplica.
- Si la forma de pago es **enlace_pago**, el cliente recibe push tipo
  `enlace_pago` con el link PayComet para pagar.
- Si es **recaptación** (cliente que estuvo de baja), el sistema
  añade el tag CRM "Recaptación" + reactiva NoofitPro.
