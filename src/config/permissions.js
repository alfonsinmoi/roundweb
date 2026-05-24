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
      pausar:             { label: 'Pausar cliente', action: true },
      asignar_categoria:  { label: 'Asignar categoría (Wellhub, Trabajador…)', action: true },
      notificar:          { label: 'Notificar (push individual)', action: true },
      reenviar_factura:   { label: 'Reenviar factura PDF', action: true },
      generar_link_pago:  { label: 'Generar link de pago PayComet', action: true },
      ver_datos_erp:      { label: 'Ver datos ERP/Odoo', action: true },
      modificar_datos_erp:{ label: '✗ Modificar datos ERP/Odoo', action: true },
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
        },
      },
      notas: {
        label: 'Notas',
        children: {
          ver_listado: { label: 'Ver tablero de notas', action: true },
          crear_nota:  { label: 'Crear nota', action: true },
          editar_nota: { label: 'Editar / asignar nota', action: true },
          cerrar_nota: { label: 'Marcar nota como hecha', action: true },
          borrar_nota: { label: '✗ Borrar nota', action: true },
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

  economico: {
    label: 'Económico',
    children: {
      cuotas_mensuales: {
        label: 'Cuotas mensuales',
        children: {
          ver:                  { label: 'Ver listado', action: true },
          reenviar_factura:     { label: 'Reenviar factura PDF', action: true },
          generar_link_pago:    { label: 'Generar link PayComet', action: true },
          marcar_pagado_manual: { label: 'Marcar pagado manualmente', action: true },
          procesar_sepa:        { label: '✗ Procesar SEPA (cobro masivo)', action: true },
          anular_pago:          { label: '✗ Anular pago (devolución)', action: true },
        },
      },
      contabilidad: {
        label: 'Contabilidad',
        children: {
          documentos: {
            label: 'Documentos',
            children: {
              ver:      { label: 'Ver documentos', action: true },
              subir:    { label: 'Subir documento (con IA)', action: true },
              validar:  { label: 'Validar documento (crea asiento Odoo)', action: true },
              rechazar: { label: 'Rechazar documento', action: true },
              borrar:   { label: '✗ Borrar documento', action: true },
            },
          },
          banco: {
            label: 'Banco',
            children: {
              ver:                { label: 'Ver movimientos', action: true },
              importar_extracto:  { label: 'Importar extracto CSV/XLSX', action: true },
              cuadrar_automatico: { label: 'Ejecutar matching automático', action: true },
              vincular_manual:    { label: 'Vincular movimiento ↔ factura', action: true },
            },
          },
          totales:           { label: 'Totales (pivot)', children: { ver: { label: 'Ver pivot', action: true } } },
          faltantes: {
            label: 'Faltantes',
            children: {
              ver:      { label: 'Ver faltantes', action: true },
              archivar: { label: 'Archivar faltante', action: true },
            },
          },
          cuenta_resultados: { label: 'Cuenta de Resultados', children: { ver: { label: 'Ver P&L', action: true } } },
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
          ver:    { label: 'Ver cuotas', action: true },
          editar: { label: 'Editar cuotas', action: true },
        },
      },
      descuentos: {
        label: 'Descuentos (catálogo)',
        children: {
          ver:    { label: 'Ver descuentos', action: true },
          editar: { label: 'Editar descuentos', action: true },
        },
      },
      modificaciones: {
        label: 'Modificaciones (catálogo)',
        children: {
          ver:    { label: 'Ver modificaciones', action: true },
          editar: { label: 'Editar modificaciones', action: true },
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
      notificaciones:      { label: 'Notificaciones (OneSignal)', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
      categorias_cliente:  { label: 'Categorías de cliente', children: { ver: { label: 'Ver', action: true }, editar: { label: 'Editar', action: true } } },
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
      checklist:           { label: 'Checklist post-activación',
        children: {
          ver: { label: 'Ver checklist', action: true },
        },
      },
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
