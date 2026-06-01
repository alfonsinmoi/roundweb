// Catálogo de permisos de la web Round.
// El editor de perfiles usa este árbol para pintar los checkboxes.
// El hook useCan('clientes.archivar') consulta este catálogo + el JSONB
// del perfil del usuario logueado.
//
// Estructura: cada nodo tiene { label, children?, action? }
// - Nodo intermedio (sin action) representa un menú/pantalla. Su clave
//   especial '_' indica si el usuario puede acceder.
// - Nodo hoja (con action=true) representa una acción concreta.
//
// Convención: ✗ marca acción destructiva o crítica (suele dejarse OFF
// por defecto en perfiles no-admin).

export const PERMISSIONS = {
  inicio: {
    label: 'Inicio (dashboard)',
    children: {
      ver: { label: 'Ver dashboard', action: true },
    },
  },

  clientes: {
    label: 'Clientes',
    children: {
      ver_listado:        { label: 'Ver listado', action: true },
      ver_perfil:         { label: 'Ver ficha de cliente', action: true },
      editar_datos:       { label: 'Editar datos personales', action: true },
      crear:              { label: 'Crear cliente nuevo', action: true },
      exportar_excel:     { label: 'Exportar listado a Excel', action: true },
      archivar:           { label: '✗ Archivar cliente (destructivo)', action: true },
      desarchivar:        { label: 'Desarchivar / reactivar cliente', action: true },
      pausar:             { label: 'Pausar cliente', action: true },
      asignar_categoria:  { label: 'Asignar categoría (Wellhub, Trabajador…)', action: true },
      notificar:          { label: 'Notificar (push individual)', action: true },
      reenviar_factura:   { label: 'Reenviar factura PDF', action: true },
      generar_link_pago:  { label: 'Generar link de pago PayComet', action: true },
      enviar_link_pago_cliente: { label: 'Enviar link de pago al cliente por email', action: true },
      cambiar_forma_pago: { label: 'Cambiar forma de pago del cliente', action: true },
      ver_datos_erp:      { label: 'Ver datos ERP/Odoo', action: true },
      modificar_datos_erp:{ label: '✗ Modificar datos ERP/Odoo', action: true },
      baja_programada: {
        label: 'Baja programada',
        children: {
          ver:                  { label: 'Ver baja programada', action: true },
          programar:            { label: 'Programar baja futura', action: true },
          cancelar_programacion:{ label: '✗ Cancelar baja programada', action: true },
        },
      },
      historial_estado: {
        label: 'Historial de estado',
        children: {
          ver_log:               { label: 'Ver log de cambios estado', action: true },
          ver_trazabilidad:      { label: 'Ver trazabilidad completa', action: true },
          forzar_sync:           { label: '✗ Forzar sync con Odoo', action: true },
          recalcular_descuentos: { label: '✗ Recalcular descuentos automáticos', action: true },
        },
      },
      familias: {
        label: 'Familias (agrupación para descuentos)',
        children: {
          ver:     { label: 'Ver familias', action: true },
          crear:   { label: 'Crear familia', action: true },
          editar:  { label: 'Editar familia', action: true },
          asignar: { label: 'Asignar / quitar miembros', action: true },
          borrar:  { label: '✗ Borrar familia', action: true },
        },
      },
      gympass: {
        label: 'Gympass / Wellhub',
        children: {
          ver:    { label: 'Ver gympassId del cliente', action: true },
          editar: { label: 'Editar gympassId', action: true },
          bulk:   { label: 'Importación masiva', action: true },
        },
      },
    },
  },

  crm: {
    label: 'CRM',
    children: {
      leads: {
        label: 'Leads (kanban)',
        children: {
          ver_kanban:   { label: 'Ver tablero kanban', action: true },
          mover_etapa:  { label: 'Mover lead entre etapas', action: true },
          editar_lead:  { label: 'Editar datos del lead', action: true },
          borrar_lead:  { label: '✗ Borrar lead', action: true },
        },
      },
      clientes_actuales: {
        label: 'Clientes actuales',
        children: {
          ver_listado:      { label: 'Ver listado', action: true },
          notificar_masivo: { label: 'Notificar a varios / cluster', action: true },
        },
      },
      agenda_social: {
        label: 'Agenda Social (Meta IG/FB)',
        children: {
          ver_posts:   { label: 'Ver posts programados', action: true },
          crear_post:  { label: 'Programar post', action: true },
          editar_post: { label: 'Editar post', action: true },
          borrar_post: { label: '✗ Borrar post', action: true },
          publicar_ya: { label: 'Publicar inmediatamente (skip schedule)', action: true },
        },
      },
      notas: {
        label: 'Notas',
        children: {
          ver_listado:   { label: 'Ver tablero de notas', action: true },
          crear_nota:    { label: 'Crear nota', action: true },
          editar_nota:   { label: 'Editar / asignar nota', action: true },
          cerrar_nota:   { label: 'Marcar nota como hecha', action: true },
          responder:     { label: 'Responder a una nota', action: true },
          recordatorio:  { label: 'Configurar recordatorio', action: true },
          borrar_nota:   { label: '✗ Borrar nota', action: true },
        },
      },
      reservas_prueba: {
        label: 'Reservas de prueba (slots)',
        children: {
          ver_slots:         { label: 'Ver slots disponibles', action: true },
          ver_leads_en_sala: { label: 'Ver leads apuntados a una sala', action: true },
          reasignar:         { label: 'Reasignar / mover reserva', action: true },
        },
      },
      lead_manual: {
        label: 'Lead manual + analítica embudo',
        children: {
          crear_manual: { label: 'Crear lead manual (desde recepción)', action: true },
          ver_funnel:   { label: 'Ver embudo de conversión', action: true },
        },
      },
      clientes_atendidos: {
        label: 'Atenciones en recepción',
        children: {
          ver:    { label: 'Ver registro de atenciones', action: true },
          crear:  { label: 'Registrar atención', action: true },
          borrar: { label: '✗ Borrar atención', action: true },
        },
      },
    },
  },

  clases: {
    label: 'Clases',
    children: {
      ver_listado:        { label: 'Ver listado de clases', action: true },
      ver_detalle:        { label: 'Ver detalle de clase', action: true },
      marcar_asistencia:  { label: 'Marcar asistencia', action: true },
      cancelar_clase:     { label: '✗ Cancelar clase (notifica a apuntados)', action: true },
    },
  },

  cuotas_clientes: {
    label: 'Cuotas asignadas (suscripciones cliente)',
    children: {
      ver:                { label: 'Ver cuotas del cliente', action: true },
      asignar:            { label: 'Asignar cuota nueva', action: true },
      reemplazar:         { label: '✗ Reemplazar suscripción activa', action: true },
      cancelar:           { label: '✗ Cancelar suscripción', action: true },
      cambiar_forma_pago: { label: 'Cambiar forma de pago de la cuota', action: true },
      asignar_descuento:  { label: 'Asignar / quitar descuento', action: true },
    },
  },

  entradas_puntuales: {
    label: 'Entradas puntuales (drop-in)',
    children: {
      ver_altas:        { label: 'Ver altas en cuota puntual', action: true },
      crear_alta:       { label: 'Dar de alta cliente en cuota puntual', action: true },
      borrar_alta:      { label: '✗ Borrar alta puntual', action: true },
      ver_eventos:      { label: 'Ver entradas detectadas', action: true },
      cobrar_recepcion: { label: 'Cobrar entrada en recepción (por_entrada)', action: true },
      anular_evento:    { label: '✗ Anular entrada detectada', action: true },
      emitir_mes:       { label: '✗ Facturar mes agregado (por_mes)', action: true },
      detectar_ahora:   { label: 'Disparar detección manual', action: true },
    },
  },

  economico: {
    label: 'Económico',
    children: {
      cuotas_mensuales: {
        label: 'Cuotas mensuales',
        children: {
          ver:                  { label: 'Ver listado', action: true },
          reenviar_factura:     { label: 'Reenviar factura PDF', action: true },
          generar_link_pago:    { label: 'Generar link PayComet', action: true },
          marcar_pagado_manual: { label: 'Botón "Pagar" — marcar recibo como pagado manualmente', action: true },
          modificar_recibo:     { label: '✗ Modificar recibo pendiente o devuelto (todos los campos)', action: true },
          procesar_sepa:        { label: '✗ Procesar SEPA (cobro masivo)', action: true },
          anular_pago:          { label: '✗ Botón "Devolver" — anular pago / devolución SEPA', action: true },
          emitir_mes:           { label: '✗ Emitir mes (genera todos los recibos del periodo)', action: true },
          editar_preemision:    { label: 'Editar recibo en preemisión', action: true },
          borrar_preemision:    { label: '✗ Borrar recibo en preemisión', action: true },
          validar_preemision:   { label: 'Validar preemisión (antes de emitir)', action: true },
          descargar_sepa:       { label: 'Descargar fichero SEPA pain.008', action: true },
          ver_devoluciones:     { label: 'Ver devoluciones PayComet', action: true },
          facturacion_trimestre_ver:    { label: 'Ver facturación trimestral', action: true },
          facturacion_trimestre_emitir: { label: '✗ Emitir facturación trimestral', action: true },
          facturacion_trimestre_excel:  { label: 'Exportar trimestre a Excel', action: true },
        },
      },
      contabilidad: {
        label: 'Contabilidad',
        children: {
          documentos: {
            label: 'Documentos',
            children: {
              ver:           { label: 'Ver documentos', action: true },
              subir:         { label: 'Subir documento (con IA)', action: true },
              validar:       { label: 'Validar documento (crea asiento Odoo)', action: true },
              rechazar:      { label: 'Rechazar documento', action: true },
              a_borrador:    { label: 'Devolver a borrador (revertir asiento)', action: true },
              ver_asiento:   { label: 'Ver asiento contable Odoo', action: true },
              borrar:        { label: '✗ Borrar documento', action: true },
            },
          },
          banco: {
            label: 'Banco',
            children: {
              ver:                { label: 'Ver movimientos', action: true },
              importar_extracto:  { label: 'Importar extracto CSV/XLSX', action: true },
              cuadrar_automatico: { label: 'Ejecutar matching automático', action: true },
              vincular_manual:    { label: 'Vincular movimiento ↔ factura', action: true },
              borrar_movimiento:  { label: '✗ Borrar movimiento bancario', action: true },
            },
          },
          totales:           { label: 'Totales (pivot)', children: { ver: { label: 'Ver pivot', action: true } } },
          faltantes: {
            label: 'Faltantes',
            children: {
              ver:        { label: 'Ver faltantes', action: true },
              archivar:   { label: 'Archivar faltante', action: true },
              designorar: { label: 'Designorar (re-incluir)', action: true },
            },
          },
          cuenta_resultados: { label: 'Cuenta de Resultados', children: { ver: { label: 'Ver P&L', action: true } } },
          categorias: {
            label: 'Categorías contables (gastos / ingresos)',
            children: {
              ver:         { label: 'Ver categorías', action: true },
              editar:      { label: 'Editar categorías', action: true },
              visibilidad: { label: 'Toggle visibilidad listado', action: true },
            },
          },
        },
      },
    },
  },

  informe_asistencia: {
    label: 'Informe de Asistencia',
    children: {
      // Tabs reales (espejo de VALID_TABS en src/pages/InformeAsistencia.jsx).
      faltas:        { label: 'Faltas de asistencia',     action: true },
      control:       { label: 'Control de asistencia',    action: true },
      distribucion:  { label: 'Distribución de clases',   action: true },
      revisar:       { label: 'Para revisar (recomendaciones)', action: true },
      riesgo:        { label: 'Clientes en riesgo (score fuga)', action: true },
      patrones:      { label: 'Análisis de patrones (clusters)', action: true },
      retos:         { label: 'Retos', action: true },
      estado_fisico: { label: 'Estado físico (tests)',    action: true },
    },
  },

  informe_clientes: {
    label: 'Informe de Clientes',
    children: {
      ver:            { label: 'Ver informe agregado de clientes', action: true },
      exportar_excel: { label: 'Exportar a Excel', action: true },
    },
  },

  informe_integridad: {
    label: 'Informe de Integridad (reservas sin cliente)',
    children: {
      ver:            { label: 'Ver listado', action: true },
      exportar_excel: { label: 'Exportar a Excel', action: true },
    },
  },

  configuracion: {
    label: 'Configuración',
    children: {
      centros_trainers: {
        label: 'Centros / Trainers',
        children: {
          ver:    { label: 'Ver centros', action: true },
          editar: { label: 'Editar centro', action: true },
          crear:  { label: '✗ Crear centro nuevo', action: true },
          borrar: { label: '✗ Borrar centro', action: true },
        },
      },
      // Cada pestaña catálogo tiene su perm. cuotas_descuentos queda como
      // legacy/compat para perfiles antiguos — los nuevos usan cuotas,
      // descuentos y modificaciones por separado.
      cuotas: {
        label: 'Cuotas (catálogo)',
        children: {
          ver:     { label: 'Ver cuotas', action: true },
          editar:  { label: 'Editar cuotas', action: true },
          crear:   { label: 'Crear cuota', action: true },
          borrar:  { label: '✗ Borrar cuota', action: true },
          adoptar: { label: 'Adoptar cuota manager-wide → trainer', action: true },
        },
      },
      descuentos: {
        label: 'Descuentos (catálogo)',
        children: {
          ver:                  { label: 'Ver descuentos', action: true },
          editar:               { label: 'Editar descuento', action: true },
          crear:                { label: 'Crear descuento', action: true },
          borrar:               { label: '✗ Borrar descuento', action: true },
          asignar_a_cliente:    { label: 'Asignar descuento a cliente', action: true },
          borrar_asignacion:    { label: '✗ Quitar asignación de descuento', action: true },
          adoptar:              { label: 'Adoptar descuento manager-wide → trainer', action: true },
        },
      },
      modificaciones: {
        label: 'Modificaciones (catálogo)',
        children: {
          ver:    { label: 'Ver modificaciones', action: true },
          editar: { label: 'Editar modificaciones', action: true },
          crear:  { label: 'Crear modificación', action: true },
          borrar: { label: '✗ Borrar modificación', action: true },
        },
      },
      modo_facturacion: {
        label: 'Forma de facturar (mensual / trimestral / directa)',
        children: {
          ver:    { label: 'Ver modo', action: true },
          editar: { label: '✗ Cambiar modo (impacto fiscal)', action: true },
        },
      },
      contabilidad_tab: {
        label: 'Contabilidad (toggle per-trainer + visibilidad listados)',
        children: {
          ver:    { label: 'Ver config', action: true },
          editar: { label: 'Editar config', action: true },
        },
      },
      cuotas_descuentos:   { label: 'Cuotas y Descuentos (legacy)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      email:               { label: 'Email (proveedores)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      email_templates:     { label: 'Plantillas email transaccional', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      pasarelas:           { label: 'Pasarelas de pago (PayComet)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar credenciales', action: true } } },
      trainer_creds:       { label: 'Credenciales NoofitPro per-trainer',
        children: {
          ver:        { label: 'Ver lista (passwords enmascaradas)', action: true },
          editar:     { label: 'Crear / editar / borrar', action: true },
          test_login: { label: 'Probar login NoofitPro', action: true },
        },
      },
      notificaciones:      { label: 'Notificaciones (OneSignal)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      categorias_cliente:  {
        label: 'Categorías de cliente',
        children: {
          ver:                { label: 'Ver catálogo', action: true },
          editar:             { label: 'Editar categoría', action: true },
          crear:              { label: 'Crear categoría', action: true },
          borrar:             { label: '✗ Borrar categoría', action: true },
          asignar_a_cliente:  { label: 'Asignar categoría a cliente', action: true },
          quitar_de_cliente:  { label: '✗ Quitar categoría de cliente', action: true },
          ver_asignaciones:   { label: 'Ver asignaciones (cliente↔categoría)', action: true },
        },
      },
      catalogos:           { label: 'Catálogos (motivos baja, etc)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      meta:                { label: 'Meta (Instagram + Facebook)',
        children: {
          ver:         { label: 'Ver cuentas', action: true },
          conectar:    { label: 'Conectar nueva cuenta', action: true },
          desconectar: { label: '✗ Desconectar cuenta', action: true },
        },
      },
      perfiles:            { label: 'Perfiles (solo admin)',
        children: { ver: { label: 'Ver', action: true }, editar: { label: 'Crear/Editar', action: true } } },
      usuarios_web:        { label: 'Usuarios web (solo admin)',
        children: {
          ver:            { label: 'Ver', action: true },
          crear:          { label: 'Crear usuario', action: true },
          editar:         { label: 'Editar usuario', action: true },
          reset_password: { label: 'Reset contraseña', action: true },
          borrar:         { label: '✗ Borrar usuario', action: true },
        },
      },
      suscripciones:       { label: 'Suscripciones Odoo (CRM / Cuotas / Contabilidad)',
        children: {
          ver:      { label: 'Ver estado de módulos', action: true },
          activar:  { label: '✗ Activar módulo Odoo (irreversible)', action: true },
        },
      },
      canales_captacion:   { label: 'Canales de captación (UTMs)',
        children: {
          ver:    { label: 'Ver canales', action: true },
          editar: { label: 'Crear / editar canal', action: true },
        },
      },
      formularios:         { label: 'Formularios de captación (embebibles)',
        children: {
          ver:    { label: 'Ver formularios', action: true },
          editar: { label: 'Crear / editar formulario', action: true },
          borrar: { label: '✗ Borrar formulario', action: true },
        },
      },
      pos:                 { label: 'Terminal de Caja (POS) — catálogo',
        children: {
          productos_ver:      { label: 'Ver productos / catálogo', action: true },
          productos_editar:   { label: 'Crear / editar productos', action: true },
          productos_archivar: { label: 'Archivar / restaurar productos', action: true },
          categorias_editar:  { label: 'Gestionar categorías per-manager', action: true },
          descuentos_editar:  { label: 'Crear / editar descuentos', action: true },
          stock_ajuste:       { label: 'Ajuste manual de stock (reposición / baja)', action: true },
          stock_historial:    { label: 'Ver historial de movimientos de stock', action: true },
        },
      },
      checklist:           { label: 'Checklist post-activación',
        children: {
          ver: { label: 'Ver checklist', action: true },
        },
      },
    },
  },

  // ── Bandeja de incidencias internas (admin) ─────────────────────────────
  // Avisos automáticos creados por el sistema cuando hay anomalías
  // (pagos parciales, sync errors, descuadres de caja…). El admin las
  // revisa y marca como leídas.
  incidencias: {
    label: 'Incidencias del sistema',
    children: {
      ver:          { label: 'Ver bandeja de incidencias', action: true },
      marcar_leida: { label: 'Marcar incidencia como leída', action: true },
    },
  },

  // ── TPV — operativa (vender / cobrar / cuadre) ──────────────────────────
  // El catálogo de productos/descuentos vive en `configuracion.pos`. Este
  // subtree es para el USO del terminal en recepción (vender, anular, cuadrar
  // caja, ver dashboard). Recepción típica: cobrar + ver. Encargados: anular
  // + cuadre + dashboard. Audit & contabilidad: dashboard + ver ventas.
  tpv: {
    label: 'TPV — Terminal de caja',
    children: {
      ventas: {
        label: 'Ventas',
        children: {
          cobrar:           { label: 'Cobrar (crear venta)', action: true },
          ver:              { label: 'Ver listado de ventas / historial', action: true },
          anular:           { label: '✗ Anular venta (revierte stock y Odoo)', action: true },
          sync_odoo:        { label: 'Reintentar sincronización con Odoo', action: true },
          force_reset_sync: { label: '✗ Forzar reset estado sync (admin)', action: true },
        },
      },
      caja: {
        label: 'Caja diaria',
        children: {
          ver:     { label: 'Ver resumen y cierres históricos', action: true },
          cerrar:  { label: 'Cerrar caja del día', action: true },
          reabrir: { label: '✗ Reabrir cierre existente (admin)', action: true },
        },
      },
      descuentos: {
        label: 'Descuentos',
        children: {
          aplicar: { label: 'Aplicar descuentos del catálogo al ticket', action: true },
        },
      },
      dashboard: {
        label: 'Dashboard analítico',
        children: {
          ver: { label: 'Ver dashboard de ventas', action: true },
        },
      },
      proveedores: {
        label: 'Facturas de proveedor (compras)',
        children: {
          ver:       { label: 'Ver listado de facturas proveedor', action: true },
          crear:     { label: 'Registrar nueva factura proveedor', action: true },
          editar:    { label: 'Editar factura proveedor (draft)', action: true },
          sync_odoo: { label: 'Reintentar sync con Odoo', action: true },
          anular:    { label: '✗ Anular factura proveedor', action: true },
        },
      },
    },
  },

  // ── (eliminado junio 2026) Subtree `recibos` era duplicado de
  // `economico.cuotas_mensuales.*`. El backend (routes/recibos.py) usa las
  // claves canónicas `marcar_pagado_manual`, `anular_pago`, `modificar_recibo`,
  // `generar_link_pago` bajo `economico.cuotas_mensuales`. Para gestionar el
  // permiso de los botones Pagar/Devolver/Modificar del listado de cuotas
  // mensuales, usa esas claves canónicas.

  // ── Control horario laboral (Fase 7, art. 34.9 ET) ──────────────────────
  // Módulo de fichaje de trabajadores con hash-chain SHA-256, QR rotativo
  // HS256, correcciones con aprobación. Activación per-manager.
  control_horario: {
    label: 'Control horario laboral',
    children: {
      modulo: {
        label: 'Módulo (suscripción)',
        children: {
          ver:        { label: 'Ver estado del módulo', action: true },
          activar:    { label: '✗ Activar módulo (irreversible)', action: true },
          desactivar: { label: '✗ Desactivar módulo', action: true },
        },
      },
      trabajadores: {
        label: 'Trabajadores',
        children: {
          ver:             { label: 'Ver listado trabajadores', action: true },
          ver_pendientes:  { label: 'Ver pendientes de autorización', action: true },
          crear:           { label: 'Alta laboral trabajador', action: true },
          editar:          { label: 'Editar datos laborales', action: true },
          autorizar:       { label: 'Autorizar trabajador propuesto', action: true },
          rechazar:        { label: '✗ Rechazar propuesto', action: true },
          baja:            { label: '✗ Dar de baja laboral', action: true },
          reactivar:       { label: 'Reactivar trabajador en baja', action: true },
          editar_trainers: { label: 'Editar vinculación a trainers', action: true },
          editar_horario:  { label: 'Editar horario laboral', action: true },
          ver_historial:   { label: 'Ver historial laboral', action: true },
        },
      },
      fichajes: {
        label: 'Fichajes (eventos)',
        children: {
          ver_eventos:  { label: 'Ver eventos de fichaje', action: true },
          ver_qr:       { label: 'Ver QR actual del centro', action: true },
          verify_chain: { label: 'Verificar hash-chain (auditoría)', action: true },
        },
      },
      correcciones: {
        label: 'Correcciones',
        children: {
          ver:              { label: 'Ver solicitudes', action: true },
          aprobar:          { label: 'Aprobar solicitud', action: true },
          rechazar:         { label: '✗ Rechazar solicitud', action: true },
          insertar_directa: { label: '✗ Insertar corrección directa (admin)', action: true },
        },
      },
      ausencias: {
        label: 'Ausencias / vacaciones',
        children: {
          ver:      { label: 'Ver solicitudes y saldos', action: true },
          aprobar:  { label: 'Aprobar solicitud', action: true },
          rechazar: { label: '✗ Rechazar solicitud', action: true },
          insertar: { label: 'Insertar ausencia directa', action: true },
        },
      },
      planificacion: {
        label: 'Planificación de turnos',
        children: {
          ver:                 { label: 'Ver temporadas / turnos', action: true },
          editar_temporadas:   { label: 'Crear / editar temporadas y apertura', action: true },
          editar_puestos:      { label: 'Crear / editar puestos y demanda', action: true },
          editar_plantillas:   { label: 'Editar turno-plantillas', action: true },
          asignar_turnos:      { label: 'Asignar turnos (bulk / patrón / copia)', action: true },
          ver_cobertura:       { label: 'Ver cobertura / equilibrio', action: true },
          editar_preferencias: { label: 'Editar preferencias trabajador', action: true },
        },
      },
      config: {
        label: 'Configuración',
        children: {
          ver_convenios:          { label: 'Ver convenios', action: true },
          editar_trainer_empresa: { label: 'Editar datos jurídicos del trainer', action: true },
          editar_pausa_motivos:   { label: 'Gestionar motivos de pausa', action: true },
        },
      },
    },
  },

  // ── Despliegue Odoo (manager) ───────────────────────────────────────────
  // Acciones de provisión Odoo más allá del toggle suscripciones — el wizard
  // de chequeo wcommerce / edición manual de id wcommerce / reintento desde
  // panel admin global.
  manager_odoo: {
    label: 'Despliegue Odoo (manager)',
    children: {
      ver_status:                   { label: 'Ver estado granular módulos', action: true },
      wc_check:                     { label: 'Consultar wcommerce tipo S', action: true },
      editar_id_wcommerce:          { label: '✗ Editar id wcommerce manual', action: true },
      trainers_contabilidad_editar: { label: 'Editar trainers con contabilidad', action: true },
      ver_solicitudes_admin:        { label: 'Ver solicitudes despliegue (admin)', action: true },
      reintentar_solicitud_admin:   { label: '✗ Reintentar despliegue (admin)', action: true },
    },
  },

  // ── Auditoría (audit log central) ───────────────────────────────────────
  auditoria: {
    label: 'Auditoría (audit log)',
    children: {
      ver: { label: 'Ver log de auditoría', action: true },
    },
  },

  // ── Configuración ERP (item separado en sidebar managerItems) ───────────
  // Pantalla /erp-configuracion, sólo visible si el manager tiene
  // contabilidad Odoo desplegada (feature flag 'contabilidad'). Configura
  // datos fiscales globales del manager (CIF, razón social, IBAN, …) que
  // se propagan a res.company de Odoo.
  erp_configuracion: {
    label: 'Configuración ERP (datos fiscales)',
    children: {
      ver:    { label: 'Ver configuración ERP', action: true },
      editar: { label: '✗ Editar configuración ERP (impacto facturas)', action: true },
    },
  },

}


// Recorre el catálogo y devuelve todas las claves canónicas como
// 'clientes.archivar', 'economico.cuotas_mensuales.procesar_sepa', etc.
export function flattenPermissions(node = PERMISSIONS, prefix = '') {
  const out = []
  for (const [key, def] of Object.entries(node)) {
    if (key === '_') continue
    const path = prefix ? `${prefix}.${key}` : key
    if (def.action) {
      out.push({ path, label: def.label, leaf: true })
    } else if (def.children) {
      out.push({ path, label: def.label, leaf: false })
      out.push(...flattenPermissions(def.children, path))
    }
  }
  return out
}


// Lee un permiso del JSONB del perfil. Path: 'clientes.archivar'.
// Si is_admin=true, devuelve true siempre (control total).
// Si el path no existe en el árbol del perfil, devuelve false (deny by default).
export function hasPermission(perfil, path) {
  if (!perfil) return false
  if (perfil.is_admin) return true
  if (!perfil.permisos) return false
  const parts = path.split('.')
  let cur = perfil.permisos
  for (let i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return false
    cur = cur[parts[i]]
  }
  return cur === true
}


// Comprueba acceso al menú/pantalla. Equivale a comprobar que cualquiera
// de las acciones hijas esté permitida (basta con poder ver algo).
export function canAccessSection(perfil, sectionPath) {
  if (!perfil) return false
  if (perfil.is_admin) return true
  // Buscar la sección en el catálogo
  const parts = sectionPath.split('.')
  let cat = PERMISSIONS
  for (const p of parts) {
    if (!cat || !cat[p]) return false
    cat = cat[p].children || cat[p]
  }
  // Recorrer hijos: si alguno está true en el JSONB, acceso permitido
  const flat = flattenPermissions(cat, sectionPath)
  return flat.some(it => it.leaf && hasPermission(perfil, it.path))
}
