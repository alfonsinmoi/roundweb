"""Validación previa antes de emitir recibos del mes.

Comprueba coherencia entre:
  - round.subscription activa en Odoo (cuota asignada)
  - cuota del cliente Round (categoría + cuota)
  - forma_pago_cliente activa
  - cliente NoofitPro (enabled=true)
  - importe esperado vs precio del catálogo cuota

Devuelve:
  - coherentes:    [cliente]
  - incoherencias: [{tipo, detalle, cliente, propuesta}]

Tipos de incoherencia:
  - sin_subscripcion         → cliente con categoría que tiene_cuota=true sin sub Odoo
  - sin_forma_pago           → cliente con sub activa pero sin forma de pago
  - cliente_inactivo_noofit  → cliente NF enabled=false con sub activa
  - importe_inconsistente    → precio sub no coincide con catálogo
  - varias_subs_misma_cuota  → bug: 2 subs activas para misma cuota
"""
import logging
from io import BytesIO
from collections import defaultdict
from flask import Blueprint, request, jsonify, g, send_file

from ..auth import auth_required
from ..db import get_conn

bp = Blueprint('preemision_validar', __name__)
log = logging.getLogger(__name__)


def _odoo():
    from ..odoo_alta import OdooAlta
    o = OdooAlta(); o._connect()
    return o


def _company_id():
    from .. import config as appconfig
    return getattr(appconfig, 'ODOO_COMPANY', 3) or 3


def _validar_emision(id_manager, mes):
    """Devuelve (coherentes, incoherencias). NO escribe nada.

    Casos detectados:
      - varias_subs_misma_cuota   2+ subs activas misma cuota
      - sin_forma_pago            sub activa pero sin forma_pago en BD
      - sepa_sin_iban             forma_pago=sepa pero IBAN vacío
      - tarjeta_sin_token         forma_pago=tarjeta_token sin card_token
      - importe_invalido          cuota sin precio para periodicidad
      - sub_sin_cuota             sub sin cuota_id asignada
      - fecha_fin_pasada_activa   sub estado=activa con fecha_fin pasada
      - cliente_inactivo_odoo     partner.active=False con sub activa
      - cliente_sin_sub           cliente con categoría tiene_cuota=true sin sub Odoo
    """
    import datetime as dt
    o = _odoo()
    company_id = _company_id()
    hoy = dt.date.today()

    subs = o._call('round.subscription', 'search_read',
        [('estado', '=', 'activa'), ('company_id', '=', company_id)],
        ['id', 'partner_id', 'cuota_id', 'periodicidad', 'forma_pago',
         'fecha_inicio', 'fecha_fin'])

    cuotas = o._call('round.cuota.catalogo', 'search_read', [],
        ['id', 'codigo', 'descripcion',
         'precio_mensual', 'precio_trimestral', 'precio_semestral', 'precio_anual'])
    cuotas_by_id = {c['id']: c for c in cuotas}

    partner_ids = list(set(s['partner_id'][0] for s in subs if s.get('partner_id')))
    partners = o._call('res.partner', 'read', partner_ids,
        ['id', 'name', 'id_noofit', 'vat', 'email', 'active'])
    partners_by_id = {p['id']: p for p in partners}

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cliente_idnoofit, forma_pago, iban, card_token, fecha_inicio
              FROM forma_pago_cliente
             WHERE id_manager = %s AND estado = 'activa'
        """, (str(id_manager),))
        fp_by_idnoofit = {r['cliente_idnoofit']: r for r in cur.fetchall()}

    # Categorías de cliente (para detectar Trabajador/Invitado/Wellhub con sub)
    cat_by_idnoofit = {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT cc.cliente_idnoofit, cat.id AS cat_id, cat.nombre AS cat_nombre,
                   cat.tiene_cuota
              FROM cliente_categoria cc
              JOIN categoria cat ON cat.id = cc.categoria_id
             WHERE cc.id_manager = %s
        """, (str(id_manager),))
        for r in cur.fetchall():
            cat_by_idnoofit[r['cliente_idnoofit']] = {
                'id': r['cat_id'], 'nombre': r['cat_nombre'],
                'tiene_cuota': r['tiene_cuota'],
            }

    # Lookup GP: DNI normalizado → {codigo, dni, nombre}
    # Para enriquecer hoja OK con DNI y código GestPlus.
    import os, json as _json, re as _re, unicodedata as _ud
    def _norm_dni(d):
        s = ''.join(c for c in _ud.normalize('NFD', str(d or ''))
                    if _ud.category(c) != 'Mn')
        return _re.sub(r'[^A-Z0-9]', '', s.upper())
    gp_by_dni, gp_by_email = {}, {}
    try:
        gp_path = os.getenv('GP_DUMP_PATH', '/opt/round_config_api/gestplus_dump_LATEST.json')
        if not os.path.exists(gp_path):
            # Fallback al dump fechado más reciente
            import glob
            cands = sorted(glob.glob('/opt/round_config_api/gestplus_dump_*.json'))
            if cands: gp_path = cands[-1]
        if os.path.exists(gp_path):
            _gp = _json.load(open(gp_path, 'r', encoding='utf-8'))
            for c in (_gp.get('altas') or []) + (_gp.get('bajas_recientes_12m') or []):
                d = _norm_dni(c.get('dni') or c.get('dniContr'))
                if d and len(d) >= 7:
                    gp_by_dni.setdefault(d, c)
                e = (c.get('email') or '').strip().lower()
                if e and '@' in e:
                    gp_by_email.setdefault(e, c)
    except Exception as e:
        log.warning(f'load GP dump for codes: {e}')

    def _gp_codigo(partner):
        d = _norm_dni(partner.get('vat'))
        gp_c = gp_by_dni.get(d) if d and len(d) >= 7 else None
        if not gp_c:
            email = (partner.get('email') or '').strip().lower()
            if email: gp_c = gp_by_email.get(email)
        if not gp_c: return ''
        cod = gp_c.get('codigo') or ''
        # Quitar padding de ceros
        s = _re.sub(r'[^0-9]', '', str(cod))
        return str(int(s)) if s else ''

    coherentes = []
    incoherencias = []
    subs_by_partner = defaultdict(list)
    for s in subs:
        if s.get('partner_id'):
            subs_by_partner[s['partner_id'][0]].append(s)

    # Imports diferidos para aplicar descuentos + modificaciones del cliente,
    # en simetría con preemision_v2.generar.
    from ..descuentos_apply import (
        calcular_precio_con_descuentos, aplicar_descuentos_familiares,
        get_descuentos_familiares_activos,
    )
    from ..modificaciones_apply import (
        get_modificaciones_activas_mes, aplicar_modif_a_cuota,
        aplicar_modif_globales,
    )

    # Pre-cómputo familias + cuotas activas por cliente (para descuento familiares)
    cuotas_activas_by_idnoofit = defaultdict(set)
    for s in subs:
        pid = s['partner_id'][0] if s.get('partner_id') else None
        if not pid: continue
        partner = partners_by_id.get(pid, {})
        idn = partner.get('id_noofit')
        if not idn: continue
        cuota = cuotas_by_id.get(s['cuota_id'][0]) if s.get('cuota_id') else None
        if cuota and cuota.get('codigo'):
            cuotas_activas_by_idnoofit[idn].add(cuota['codigo'])

    familia_por_cliente = {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT m.cliente_idnoofit AS yo, ARRAY(
                SELECT cliente_idnoofit FROM familia_miembro mm
                 WHERE mm.familia_id = m.familia_id
            ) AS miembros
              FROM familia_miembro m
             WHERE m.id_manager = %s
        """, (str(id_manager),))
        for r in cur.fetchall():
            familia_por_cliente[r['yo']] = r.get('miembros') or []
    descuentos_familiares = get_descuentos_familiares_activos(id_manager)

    # Helper: precio aplicado a una sub SIN descuentos ni modificaciones.
    def _precio_sub(s):
        if not s.get('cuota_id'): return 0.0
        cuota = cuotas_by_id.get(s['cuota_id'][0])
        if not cuota: return 0.0
        return float(cuota.get(f'precio_{s.get("periodicidad","mensual")}') or 0)

    # Helper: precio sub TRAS descuentos del catálogo + descuentos familiares
    # automáticos + modificaciones puntuales.
    def _precio_sub_con_ajustes(s, idnoofit, cuotas_activas_codigos, modifs_mes):
        if not s.get('cuota_id'): return 0.0
        cuota = cuotas_by_id.get(s['cuota_id'][0])
        if not cuota: return 0.0
        p_normal = float(cuota.get(f'precio_{s.get("periodicidad","mensual")}') or 0)
        # 1) Descuentos del catálogo asignados al cliente
        p_tras_desc, _info_d = calcular_precio_con_descuentos(
            id_manager, idnoofit, cuota.get('codigo'), p_normal,
            cuotas_activas_codigos=cuotas_activas_codigos)
        # 2) Descuento automático por familia (≥2 miembros con la cuota)
        miembros_fam = familia_por_cliente.get(idnoofit) or []
        cuotas_por_familiar = {
            idn: cuotas_activas_by_idnoofit.get(idn, set())
            for idn in miembros_fam
        }
        p_tras_fam, _info_f = aplicar_descuentos_familiares(
            id_manager, idnoofit, cuota.get('codigo'), p_tras_desc,
            cuotas_por_familiar, descuentos_familiares=descuentos_familiares)
        # 3) Modificaciones por cuota
        p_final, _info_m, _ids = aplicar_modif_a_cuota(modifs_mes, cuota['id'], p_tras_fam)
        return p_final

    for pid, plist in subs_by_partner.items():
        partner = partners_by_id.get(pid, {})
        idnoofit = partner.get('id_noofit') or ''
        nombre = partner.get('name') or '?'
        cliente_info = {
            'partner_id': pid, 'idnoofit': idnoofit, 'nombre': nombre,
            'email': partner.get('email') or '',
            'dni': partner.get('vat') or '',
            'codigo_gp': _gp_codigo(partner),
        }
        problemas = []

        # cliente_inactivo_odoo
        if partner.get('active') is False:
            problemas.append({
                'tipo': 'cliente_inactivo_odoo',
                'detalle': 'Partner Odoo inactivo (active=False) con sub activa',
                'propuesta': 'Reactivar el partner en Odoo o cancelar las subs.',
            })

        # cat_sin_cuota_con_sub: cliente con categoría Trabajador/Invitado/Wellhub
        # (tiene_cuota=false) pero con suscripción activa → no debería emitir recibos.
        cat = cat_by_idnoofit.get(idnoofit) or {}
        if cat and cat.get('tiene_cuota') is False:
            problemas.append({
                'tipo': 'cat_sin_cuota_con_sub',
                'detalle': (f'Categoría "{cat.get("nombre","?")}" no debería tener cuota, '
                            f'pero hay {len(plist)} sub(s) activa(s) en Odoo'),
                'propuesta': ('Cancelar las suscripciones (no le cobramos) o cambiar la '
                              'categoría a "Cliente" si es socio de pago.'),
            })

        # varias_subs_misma_cuota
        cuotas_count = defaultdict(int)
        for s in plist:
            if s.get('cuota_id'): cuotas_count[s['cuota_id'][0]] += 1
        for cid, n in cuotas_count.items():
            if n > 1:
                cuota = cuotas_by_id.get(cid, {})
                problemas.append({
                    'tipo': 'varias_subs_misma_cuota',
                    'detalle': f'{n} subs activas para cuota {cuota.get("codigo","?")}',
                    'propuesta': f'Cancelar las {n-1} subs sobrantes y dejar solo una activa.',
                })

        # sub_sin_cuota
        for s in plist:
            if not s.get('cuota_id'):
                problemas.append({
                    'tipo': 'sub_sin_cuota',
                    'detalle': f'Sub id={s["id"]} sin cuota_id asignada',
                    'propuesta': 'Editar la subscription y asignar una cuota del catálogo.',
                })

        # fecha_fin_pasada_activa
        for s in plist:
            ff = s.get('fecha_fin')
            if ff:
                if isinstance(ff, str): ff = dt.datetime.fromisoformat(ff[:10]).date()
                if ff < hoy:
                    problemas.append({
                        'tipo': 'fecha_fin_pasada_activa',
                        'detalle': f'Sub id={s["id"]} estado=activa con fecha_fin={ff.isoformat()} < hoy',
                        'propuesta': 'Cambiar estado a "cancelada" o quitar fecha_fin.',
                    })

        # forma de pago
        fp = fp_by_idnoofit.get(idnoofit)
        if not fp:
            problemas.append({
                'tipo': 'sin_forma_pago',
                'detalle': 'Cliente sin forma de pago activa en BD',
                'propuesta': 'Configurar forma de pago en perfil del cliente (pestaña Cuota y fechas).',
            })
        else:
            if fp['forma_pago'] == 'sepa' and not (fp.get('iban') or '').strip():
                problemas.append({
                    'tipo': 'sepa_sin_iban',
                    'detalle': 'forma_pago=sepa pero IBAN vacío',
                    'propuesta': 'Añadir IBAN al cliente o cambiar forma de pago a efectivo.',
                })
            if fp['forma_pago'] == 'tarjeta_token' and not (fp.get('card_token') or '').strip():
                problemas.append({
                    'tipo': 'tarjeta_sin_token',
                    'detalle': 'forma_pago=tarjeta_token pero sin card_token',
                    'propuesta': 'Tokenizar la tarjeta o cambiar forma de pago.',
                })

        # importe_invalido
        for s in plist:
            cuota = cuotas_by_id.get(s['cuota_id'][0]) if s.get('cuota_id') else None
            if not cuota: continue
            campo_precio = f'precio_{s["periodicidad"]}'
            precio_catalogo = float(cuota.get(campo_precio) or 0)
            if precio_catalogo <= 0:
                problemas.append({
                    'tipo': 'importe_invalido',
                    'detalle': f'Cuota {cuota.get("codigo")} sin precio para periodicidad {s["periodicidad"]}',
                    'propuesta': f'Configurar precio_{s["periodicidad"]} en catálogo cuotas.',
                })

        # importe_inconsistente: misma cuota con periodicidades distintas
        per_by_cuota = defaultdict(set)
        for s in plist:
            if s.get('cuota_id'): per_by_cuota[s['cuota_id'][0]].add(s.get('periodicidad'))
        for cid, pers in per_by_cuota.items():
            if len(pers) > 1:
                cuota = cuotas_by_id.get(cid, {})
                problemas.append({
                    'tipo': 'importe_inconsistente',
                    'detalle': f'Cuota {cuota.get("codigo")} con varias periodicidades: {sorted(pers)}',
                    'propuesta': 'Dejar solo una periodicidad activa.',
                })

        for p in problemas:
            incoherencias.append({**p, 'cliente': cliente_info})

        if not problemas:
            # Set de códigos de cuotas activas del cliente (para 'varias_cuotas')
            cuotas_activas_cli = set()
            for s in plist:
                cu = cuotas_by_id.get(s['cuota_id'][0]) if s.get('cuota_id') else None
                if cu and cu.get('codigo'):
                    cuotas_activas_cli.add(cu['codigo'])
            # Modificaciones vigentes del cliente para el mes
            modifs_mes = get_modificaciones_activas_mes(id_manager, idnoofit, mes) if idnoofit else []

            # Cuotas por miembro (para descuento familiares)
            miembros_fam = familia_por_cliente.get(idnoofit) or []
            cuotas_por_familiar = {
                idn: cuotas_activas_by_idnoofit.get(idn, set())
                for idn in miembros_fam
            }

            # Detalle por cuota: precio_normal y precio_final tras descuentos+mods
            cuotas_detalle = []
            importe_subtotal = 0.0
            for s in plist:
                if not s.get('cuota_id'): continue
                cuota = cuotas_by_id.get(s['cuota_id'][0])
                if not cuota: continue
                p_normal = float(cuota.get(f'precio_{s.get("periodicidad","mensual")}') or 0)
                # 1) Descuentos asignados
                p_tras_desc, info_desc = calcular_precio_con_descuentos(
                    id_manager, idnoofit, cuota.get('codigo'), p_normal,
                    cuotas_activas_codigos=cuotas_activas_cli)
                # 2) Descuento automático por familia
                p_tras_fam, info_fam = aplicar_descuentos_familiares(
                    id_manager, idnoofit, cuota.get('codigo'), p_tras_desc,
                    cuotas_por_familiar, descuentos_familiares=descuentos_familiares)
                # 3) Modificaciones por cuota
                p_final, info_mod, _ids = aplicar_modif_a_cuota(
                    modifs_mes, cuota['id'], p_tras_fam)
                importe_subtotal += p_final
                desc_partes = list(info_desc or []) + list(info_fam or [])
                cuotas_detalle.append({
                    'codigo': cuota.get('codigo') or '?',
                    'periodicidad': s.get('periodicidad'),
                    'precio_normal': round(p_normal, 2),
                    'precio_final': round(p_final, 2),
                    'descuentos': [
                        f"{x['descuento_codigo']} ({x['precio_antes']}€→{x['precio_despues']}€)"
                        for x in desc_partes
                    ],
                    'modificaciones': [
                        f"{m['tipo']} {m['valor']}€" + (f": {m['razon']}" if m.get('razon') else '')
                        for m in info_mod
                    ] if info_mod else [],
                })

            # Aplicar modificaciones globales (sin cuota_id) sobre el total
            importe_total, info_global, _ids_g = aplicar_modif_globales(
                modifs_mes, importe_subtotal)
            modif_globales_label = [
                f"{m['tipo']} {m['valor']}€" + (f": {m['razon']}" if m.get('razon') else '')
                for m in info_global
            ] if info_global else []

            forma_pago = (fp or {}).get('forma_pago', '?')
            # Periodicidad principal (la más común entre las subs del cliente)
            from collections import Counter as _Counter
            per_counts = _Counter(s.get('periodicidad') for s in plist if s.get('periodicidad'))
            periodicidad = per_counts.most_common(1)[0][0] if per_counts else 'mensual'
            cuotas_codigos = sorted({d['codigo'] for d in cuotas_detalle})
            coherentes.append({
                **cliente_info,    # incluye dni y codigo_gp
                'subs': len(plist),
                'cuotas': cuotas_codigos,
                'cuotas_detalle': cuotas_detalle,
                'modificaciones_globales': modif_globales_label,
                'forma_pago': forma_pago,
                'iban': (fp or {}).get('iban', ''),
                'periodicidad': periodicidad,
                'importe_total': round(importe_total, 2),
                'categoria': (cat or {}).get('nombre', ''),
            })

    # cliente_sin_sub: clientes con categoría tiene_cuota=true sin sub activa.
    # Enriquecemos con:
    #   - nombre/email desde un partner Odoo con ese id_noofit (si existe,
    #     aunque no tenga sub) — vía búsqueda batch.
    #   - fallback al `recibo.cliente_nombre` más reciente en BD.
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT cc.cliente_idnoofit, cat.nombre AS categoria_nombre
                  FROM cliente_categoria cc
                  JOIN categoria cat ON cat.id = cc.categoria_id
                 WHERE cc.id_manager=%s AND cat.tiene_cuota=TRUE AND cat.activa=TRUE
            """, (str(id_manager),))
            con_cuota_obligada = {r['cliente_idnoofit']: r['categoria_nombre'] for r in cur.fetchall()}
        idnoofits_con_sub = {partners_by_id[pid].get('id_noofit')
                             for pid in subs_by_partner if partners_by_id.get(pid, {}).get('id_noofit')}
        sin_sub_idnoofits = [idn for idn in con_cuota_obligada
                             if idn not in idnoofits_con_sub]

        # 1) Buscar partners Odoo (sin filtrar por sub) por id_noofit
        partner_lookup = {}    # idnoofit → {partner_id, name, email, active}
        if sin_sub_idnoofits:
            try:
                rows = o._call('res.partner', 'search_read',
                    [('id_noofit', 'in', sin_sub_idnoofits),
                     ('company_id', 'in', [False, company_id])],
                    ['id', 'id_noofit', 'name', 'email', 'active'])
                for r in rows:
                    if r.get('id_noofit'):
                        partner_lookup[r['id_noofit']] = r
            except Exception as e:
                log.warning(f'partner_lookup: {e}')

        # 2) Fallback: nombre desde recibo (último cliente_nombre cacheado)
        nombre_recibo = {}
        if sin_sub_idnoofits:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT ON (cliente_idnoofit) cliente_idnoofit, cliente_nombre
                      FROM recibo
                     WHERE id_manager = %s AND cliente_idnoofit = ANY(%s)
                       AND cliente_nombre IS NOT NULL AND cliente_nombre <> ''
                     ORDER BY cliente_idnoofit, fecha_emision DESC
                """, (str(id_manager), sin_sub_idnoofits))
                for r in cur.fetchall():
                    nombre_recibo[r['cliente_idnoofit']] = r['cliente_nombre']

        # 3) Fallback: nombre/email desde dump NoofitPro local
        # (`/opt/round_config_api/noofit_clientes_dump.json`). Cubre clientes
        # que aún no tienen partner Odoo ni recibos pero existen en NF.
        # Además marca si están archivados (enabled=false) para sugerir baja.
        nf_lookup = {}    # idnoofit → {name, surname, email, enabled}
        try:
            import os, json as _json
            dump_path = os.getenv(
                'NOOFIT_DUMP_PATH',
                '/opt/round_config_api/noofit_clientes_dump.json',
            )
            if os.path.exists(dump_path) and sin_sub_idnoofits:
                _ids = set(sin_sub_idnoofits)
                with open(dump_path, 'r', encoding='utf-8') as f:
                    _dump = _json.load(f)
                for c in _dump.get('clientes', []):
                    idn = str(c.get('id') or '')
                    if idn in _ids:
                        nf_lookup[idn] = {
                            'name': (c.get('name') or '').strip(),
                            'surname': (c.get('surname') or '').strip(),
                            'email': (c.get('email') or '').strip(),
                            'enabled': bool(c.get('enabled')),
                        }
        except Exception as e:
            log.warning(f'nf_dump fallback: {e}')

        for idnoofit in sin_sub_idnoofits:
            cat_nombre = con_cuota_obligada[idnoofit]
            p = partner_lookup.get(idnoofit) or {}
            nf = nf_lookup.get(idnoofit) or {}
            # Prioridad: Odoo > recibo > NF dump
            nombre = (p.get('name') or '').strip()
            if not nombre and nombre_recibo.get(idnoofit):
                nombre = nombre_recibo[idnoofit]
            if not nombre and (nf.get('name') or nf.get('surname')):
                nombre = (nf.get('name', '') + ' ' + nf.get('surname', '')).strip()
            email = (p.get('email') or '').strip() or nf.get('email') or ''
            partner_id = p.get('id') or None

            # Detectar archivado en NF → sugerir baja de categoría
            propuesta = 'Asignar cuota desde el perfil del cliente.'
            detalle_extra = ''
            if nf and nf.get('enabled') is False:
                propuesta = ('Cliente archivado en NoofitPro. Quitar la categoría '
                             '"' + cat_nombre + '" o reactivarlo en NF.')
                detalle_extra = ' [archivado en NF]'
            elif p.get('active') is False:
                propuesta = ('Partner Odoo inactivo. Reactivarlo y asignar cuota, '
                             'o cambiar la categoría del cliente a una sin cuota.')

            incoherencias.append({
                'tipo': 'cliente_sin_sub',
                'detalle': (f'Categoría "{cat_nombre}" (tiene_cuota=true) '
                            f'pero sin sub activa Odoo' + detalle_extra),
                'cliente': {'partner_id': partner_id, 'idnoofit': idnoofit,
                            'nombre': nombre, 'email': email},
                'propuesta': propuesta,
            })
    except Exception as e:
        log.warning(f'cliente_sin_sub check: {e}')

    # ─── Resumen agregado de lo que se va a emitir ───────────────────────
    resumen = _resumir_emision(coherentes)

    return coherentes, incoherencias, resumen


def _historico_mensual(id_manager, mes_objetivo, n_meses=13):
    """Extrae desglose mensual de recibos ya emitidos (tabla `recibo`).

    Devuelve dict ordenado: {YYYY-MM: {total_recibos, total_importe,
                                       por_forma_pago, por_periodicidad,
                                       por_cuota}}
    Solo incluye meses ANTERIORES a mes_objetivo (no incluye mes_objetivo).

    Mapeo metodo_pago BD → forma_pago canónica:
      sepa → sepa | caja_* → efectivo | tarjeta_tok → tarjeta_token
      enlace_pago → enlace_pago
    """
    import datetime as dt
    from collections import defaultdict
    # Calcular ventana
    y, m = mes_objetivo.split('-')
    fecha_obj = dt.date(int(y), int(m), 1)
    meses = []
    for i in range(n_meses, 0, -1):
        # Restar i meses
        mm = fecha_obj.month - i; yy = fecha_obj.year
        while mm <= 0: mm += 12; yy -= 1
        meses.append(f'{yy}-{mm:02d}')

    if not meses: return {}

    METODO_MAP = {
        'sepa': 'sepa',
        'caja_efectivo': 'efectivo',
        'caja_tpv_fisico': 'efectivo',
        'caja_tpv_virtual': 'efectivo',
        'tarjeta_tok': 'tarjeta_token',
        'enlace_pago': 'enlace_pago',
    }

    def _familia_cuota(codigo):
        """Mapea códigos GestPlus antiguos a las familias de cuota actuales.
          RT LX/MJ * → RT 2 dias  (antes 2 sesiones/semana, ahora 1 sub)
          RT 1D     → RT 1D
          I MYGYM * → I MYGYM
          otros     → tal cual
        """
        if not codigo: return '?'
        c = codigo.strip()
        cu = c.upper()
        if cu.startswith('RT 1D'): return 'RT 1D'
        if cu.startswith('RT LX') or cu.startswith('RT MJ'): return 'RT 2 dias'
        if cu.startswith('I MYGYM'): return 'I MYGYM'
        return c

    out = {m: {
        'total_recibos': 0, 'total_importe': 0.0,
        'por_forma_pago': defaultdict(lambda: {'n': 0, 'importe': 0.0}),
        'por_periodicidad': defaultdict(lambda: {'n': 0, 'importe': 0.0}),
        'por_cuota': defaultdict(lambda: {'n': 0, 'importe': 0.0}),
    } for m in meses}

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT periodo, metodo_pago, periodicidad, cuota_codigo,
                   COUNT(*) AS n, COALESCE(SUM(importe_total), 0) AS total
              FROM recibo
             WHERE id_manager = %s AND periodo = ANY(%s)
               AND estado IN ('emitido', 'pagado', 'facturado')
             GROUP BY periodo, metodo_pago, periodicidad, cuota_codigo
        """, (str(id_manager), meses))
        for r in cur.fetchall():
            mes = r['periodo']
            if mes not in out: continue
            n = int(r['n']); total = float(r['total'] or 0)
            out[mes]['total_recibos'] += n
            out[mes]['total_importe'] += total
            fp = METODO_MAP.get(r['metodo_pago'], r['metodo_pago'] or '?')
            out[mes]['por_forma_pago'][fp]['n'] += n
            out[mes]['por_forma_pago'][fp]['importe'] += total
            per = r['periodicidad'] or 'mensual'
            out[mes]['por_periodicidad'][per]['n'] += n
            out[mes]['por_periodicidad'][per]['importe'] += total
            cod = _familia_cuota(r['cuota_codigo'])
            out[mes]['por_cuota'][cod]['n'] += n
            out[mes]['por_cuota'][cod]['importe'] += total

    # Convertir defaultdict a dict y redondear; filtrar meses sin datos
    final = {}
    for mes in meses:  # respeta orden cronológico
        if out[mes]['total_recibos'] == 0:
            continue   # no incluimos meses sin recibos
        out[mes]['total_importe'] = round(out[mes]['total_importe'], 2)
        for k in ('por_forma_pago', 'por_periodicidad', 'por_cuota'):
            d = out[mes][k]
            for kk in d:
                d[kk]['importe'] = round(d[kk]['importe'], 2)
            out[mes][k] = dict(d)
        final[mes] = out[mes]
    return final


def _resumir_emision(coherentes):
    """Calcula totales agregados para los recibos a emitir.

    Devuelve un dict con:
      - total_recibos / total_importe
      - por_forma_pago: {sepa: {n, importe}, efectivo:..., tarjeta_token:...}
      - por_cuota: {codigo: {n, importe}}
      - por_periodicidad: {mensual: {n, importe}, ...}
    """
    total_recibos = len(coherentes)
    total_importe = round(sum(c.get('importe_total', 0) for c in coherentes), 2)

    por_forma_pago = defaultdict(lambda: {'n': 0, 'importe': 0.0})
    por_periodicidad = defaultdict(lambda: {'n': 0, 'importe': 0.0})
    por_cuota = defaultdict(lambda: {'n': 0, 'importe': 0.0})

    for c in coherentes:
        imp = c.get('importe_total', 0) or 0
        fp = c.get('forma_pago', '?')
        per = c.get('periodicidad', 'mensual')
        por_forma_pago[fp]['n'] += 1
        por_forma_pago[fp]['importe'] += imp
        por_periodicidad[per]['n'] += 1
        por_periodicidad[per]['importe'] += imp
        # Por cuota: usar el precio_final real por cuota (con descuentos+mods).
        # Si no hay detalle (compatibilidad), repartir el total a partes iguales.
        detalle = c.get('cuotas_detalle') or []
        if detalle:
            for d in detalle:
                cod = d.get('codigo') or '?'
                por_cuota[cod]['n'] += 1
                por_cuota[cod]['importe'] += float(d.get('precio_final') or 0)
        else:
            for cod in (c.get('cuotas') or ['?']):
                por_cuota[cod]['n'] += 1
                por_cuota[cod]['importe'] += imp / max(1, len(c.get('cuotas') or [1]))

    # Redondear importes
    for d in (por_forma_pago, por_periodicidad, por_cuota):
        for k in d:
            d[k]['importe'] = round(d[k]['importe'], 2)

    return {
        'total_recibos': total_recibos,
        'total_importe': total_importe,
        'por_forma_pago': dict(por_forma_pago),
        'por_periodicidad': dict(por_periodicidad),
        'por_cuota': dict(por_cuota),
    }


@bp.route('/<mes>/validar', methods=['GET'])
@auth_required
def validar(mes):
    try:
        coherentes, incoherencias, resumen = _validar_emision(g.id_manager, mes)
        # Stats por tipo
        from collections import Counter
        por_tipo = dict(Counter(i['tipo'] for i in incoherencias))
        try:
            historico = _historico_mensual(g.id_manager, mes, n_meses=13)
        except Exception as e:
            log.warning(f'historico_mensual: {e}')
            historico = {}
        return jsonify({
            'ok': True,
            'mes': mes,
            'coherentes': len(coherentes),
            'incoherencias': len(incoherencias),
            'por_tipo': por_tipo,
            'resumen_emision': resumen,
            'historico': historico,
            'detalle': incoherencias[:200],   # cap
        })
    except Exception as e:
        log.exception('validar')
        return jsonify({'ok': False, 'error': str(e)}), 500


@bp.route('/<mes>/validar/excel', methods=['GET'])
@auth_required
def validar_excel(mes):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        from openpyxl.utils import get_column_letter

        coherentes, incoherencias, resumen = _validar_emision(g.id_manager, mes)

        wb = Workbook(); wb.remove(wb.active)
        border = Border(*[Side(style='thin', color='CCCCCC')] * 4)
        font_h = Font(bold=True, color='FFFFFF', size=11)
        font_subh = Font(bold=True, size=11, color='1F2937')
        fill_total = PatternFill('solid', fgColor='DBEAFE')

        # ─── RESUMEN ─────────────────────────────────────────────────────
        ws = wb.create_sheet('RESUMEN')
        ws.column_dimensions['A'].width = 38
        ws.column_dimensions['B'].width = 14
        ws.column_dimensions['C'].width = 14

        ws.cell(1, 1, f'Validación pre-emisión — {mes}').font = Font(bold=True, size=14)

        # Totales generales
        ws.cell(3, 1, 'Total recibos a emitir:').font = font_subh
        ws.cell(3, 2, resumen.get('total_recibos', 0)).font = Font(bold=True)
        ws.cell(3, 2).fill = fill_total
        ws.cell(4, 1, 'Importe total (€):').font = font_subh
        ws.cell(4, 2, resumen.get('total_importe', 0)).font = Font(bold=True)
        ws.cell(4, 2).fill = fill_total
        ws.cell(4, 2).number_format = '#,##0.00 €'

        ws.cell(5, 1, 'Incoherencias detectadas:').font = Font(bold=True, color='C00000')
        ws.cell(5, 2, len(incoherencias))

        # Por forma de pago
        r = 7
        ws.cell(r, 1, 'POR FORMA DE PAGO').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 1).fill = PatternFill('solid', fgColor='2563EB')
        ws.cell(r, 2, '# Recibos').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 2).fill = PatternFill('solid', fgColor='2563EB')
        ws.cell(r, 3, 'Importe €').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 3).fill = PatternFill('solid', fgColor='2563EB')
        for col in (1, 2, 3): ws.cell(r, col).alignment = Alignment(horizontal='center')
        r += 1
        for fp, d in sorted(resumen.get('por_forma_pago', {}).items(),
                            key=lambda x: -x[1]['importe']):
            ws.cell(r, 1, fp)
            ws.cell(r, 2, d['n'])
            ws.cell(r, 3, d['importe']).number_format = '#,##0.00 €'
            r += 1

        # Por periodicidad
        r += 1
        ws.cell(r, 1, 'POR PERIODICIDAD').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 1).fill = PatternFill('solid', fgColor='7C3AED')
        ws.cell(r, 2, '# Recibos').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 2).fill = PatternFill('solid', fgColor='7C3AED')
        ws.cell(r, 3, 'Importe €').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 3).fill = PatternFill('solid', fgColor='7C3AED')
        for col in (1, 2, 3): ws.cell(r, col).alignment = Alignment(horizontal='center')
        r += 1
        for per, d in sorted(resumen.get('por_periodicidad', {}).items(),
                             key=lambda x: -x[1]['importe']):
            ws.cell(r, 1, per)
            ws.cell(r, 2, d['n'])
            ws.cell(r, 3, d['importe']).number_format = '#,##0.00 €'
            r += 1

        # Por cuota
        r += 1
        ws.cell(r, 1, 'POR CUOTA').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 1).fill = PatternFill('solid', fgColor='059669')
        ws.cell(r, 2, '# Recibos').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 2).fill = PatternFill('solid', fgColor='059669')
        ws.cell(r, 3, 'Importe €').font = Font(bold=True, color='FFFFFF')
        ws.cell(r, 3).fill = PatternFill('solid', fgColor='059669')
        for col in (1, 2, 3): ws.cell(r, col).alignment = Alignment(horizontal='center')
        r += 1
        for cod, d in sorted(resumen.get('por_cuota', {}).items(),
                             key=lambda x: -x[1]['importe']):
            ws.cell(r, 1, cod)
            ws.cell(r, 2, d['n'])
            ws.cell(r, 3, d['importe']).number_format = '#,##0.00 €'
            r += 1

        # ─── COMPARATIVA HISTÓRICA ───────────────────────────────────────
        try:
            historico = _historico_mensual(g.id_manager, mes, n_meses=13)
        except Exception as e:
            log.warning(f'historico_mensual: {e}')
            historico = {}

        if historico:
            meses_orden = list(historico.keys()) + [mes]
            # Recopilar todas las claves a comparar
            forma_pagos_all = set()
            periodicidades_all = set()
            cuotas_all = set()
            for mh in historico.values():
                forma_pagos_all.update(mh['por_forma_pago'].keys())
                periodicidades_all.update(mh['por_periodicidad'].keys())
                cuotas_all.update(mh['por_cuota'].keys())
            forma_pagos_all.update(resumen.get('por_forma_pago', {}).keys())
            periodicidades_all.update(resumen.get('por_periodicidad', {}).keys())
            cuotas_all.update(resumen.get('por_cuota', {}).keys())

            r += 2
            ws.cell(r, 1, f'COMPARATIVA HISTÓRICA — últimos {len(historico)} meses + previsión {mes}').font = Font(bold=True, color='FFFFFF', size=12)
            ws.cell(r, 1).fill = PatternFill('solid', fgColor='0F766E')
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=len(meses_orden) + 2)
            r += 1

            # Cabeceras: Concepto | mes1 | mes2 | ... | mes_obj* | Δ %
            fill_thead = PatternFill('solid', fgColor='115E59')
            ws.cell(r, 1, 'Concepto').font = font_h
            ws.cell(r, 1).fill = fill_thead
            ws.cell(r, 1).border = border
            for col_idx, mh in enumerate(meses_orden, start=2):
                label = mh + (' *' if mh == mes else '')
                c = ws.cell(r, col_idx, label)
                c.font = font_h; c.fill = fill_thead; c.border = border
                c.alignment = Alignment(horizontal='center')
            delta_col = len(meses_orden) + 2
            c = ws.cell(r, delta_col, 'Δ % vs mes ant.')
            c.font = font_h; c.fill = fill_thead; c.border = border
            c.alignment = Alignment(horizontal='center')
            ws.column_dimensions[get_column_letter(delta_col)].width = 16

            for col_idx in range(2, delta_col):
                ws.column_dimensions[get_column_letter(col_idx)].width = 13

            r += 1

            def _val_mes(mh_key, modo, cat=None):
                """Devuelve nº/importe de una categoría en un mes dado.
                modo: 'n_total', 'imp_total', 'n_fp', 'imp_fp', etc."""
                if mh_key == mes:
                    src = resumen
                else:
                    src = historico.get(mh_key, {})
                if modo == 'n_total': return src.get('total_recibos', 0)
                if modo == 'imp_total': return src.get('total_importe', 0)
                if modo == 'n_fp': return src.get('por_forma_pago', {}).get(cat, {}).get('n', 0)
                if modo == 'imp_fp': return src.get('por_forma_pago', {}).get(cat, {}).get('importe', 0)
                if modo == 'n_per': return src.get('por_periodicidad', {}).get(cat, {}).get('n', 0)
                if modo == 'imp_per': return src.get('por_periodicidad', {}).get(cat, {}).get('importe', 0)
                if modo == 'n_cuota': return src.get('por_cuota', {}).get(cat, {}).get('n', 0)
                if modo == 'imp_cuota': return src.get('por_cuota', {}).get(cat, {}).get('importe', 0)
                return 0

            def _add_row(concepto, modo, cat=None, is_imp=False, fill_row=None,
                         bold_label=False):
                nonlocal r
                cell = ws.cell(r, 1, concepto)
                cell.border = border
                if bold_label: cell.font = Font(bold=True)
                if fill_row: cell.fill = fill_row
                vals = []
                for col_idx, mh_key in enumerate(meses_orden, start=2):
                    v = _val_mes(mh_key, modo, cat)
                    vals.append(v)
                    c = ws.cell(r, col_idx, v)
                    c.border = border
                    if is_imp: c.number_format = '#,##0.00 €'
                    if fill_row: c.fill = fill_row
                # Δ%
                if len(vals) >= 2 and vals[-2]:
                    delta = (vals[-1] - vals[-2]) / vals[-2] * 100
                    c = ws.cell(r, delta_col, delta / 100)
                    c.number_format = '+0.0%;-0.0%;0.0%'
                    c.border = border
                    if delta < -5:
                        c.font = Font(color='C00000', bold=True)
                    elif delta > 5:
                        c.font = Font(color='006400', bold=True)
                    if fill_row: c.fill = fill_row
                else:
                    c = ws.cell(r, delta_col, '—')
                    c.alignment = Alignment(horizontal='center')
                    c.border = border
                    if fill_row: c.fill = fill_row
                r += 1

            # Totales
            fill_total_row = PatternFill('solid', fgColor='DBEAFE')
            _add_row('TOTAL # recibos', 'n_total', bold_label=True, fill_row=fill_total_row)
            _add_row('TOTAL importe (€)', 'imp_total', is_imp=True, bold_label=True, fill_row=fill_total_row)

            # Por forma de pago
            r += 1
            ws.cell(r, 1, '— Por forma de pago —').font = Font(italic=True, color='2563EB')
            r += 1
            for fp in sorted(forma_pagos_all):
                _add_row(f'  {fp} — # recibos', 'n_fp', cat=fp)
                _add_row(f'  {fp} — importe', 'imp_fp', cat=fp, is_imp=True)

            # Por periodicidad
            r += 1
            ws.cell(r, 1, '— Por periodicidad —').font = Font(italic=True, color='7C3AED')
            r += 1
            for per in sorted(periodicidades_all):
                _add_row(f'  {per} — # recibos', 'n_per', cat=per)
                _add_row(f'  {per} — importe', 'imp_per', cat=per, is_imp=True)

            # Por cuota
            r += 1
            ws.cell(r, 1, '— Por cuota —').font = Font(italic=True, color='059669')
            r += 1
            for cod in sorted(cuotas_all):
                _add_row(f'  {cod} — # recibos', 'n_cuota', cat=cod)
                _add_row(f'  {cod} — importe', 'imp_cuota', cat=cod, is_imp=True)

        # Tipos de incoherencia
        if incoherencias:
            r += 1
            ws.cell(r, 1, 'INCOHERENCIAS POR TIPO').font = Font(bold=True, color='FFFFFF')
            ws.cell(r, 1).fill = PatternFill('solid', fgColor='DC2626')
            ws.cell(r, 2, '# Casos').font = Font(bold=True, color='FFFFFF')
            ws.cell(r, 2).fill = PatternFill('solid', fgColor='DC2626')
            for col in (1, 2): ws.cell(r, col).alignment = Alignment(horizontal='center')
            r += 1
            from collections import Counter
            tipos = Counter(i['tipo'] for i in incoherencias)
            for t, n in tipos.most_common():
                ws.cell(r, 1, t); ws.cell(r, 2, n); r += 1

        # ─── INCOHERENCIAS ──────────────────────────────────────────────
        if incoherencias:
            ws = wb.create_sheet('INCOHERENCIAS')
            heads = [('Tipo', 22), ('Cliente', 30), ('idnoofit', 11), ('Email', 26),
                     ('Detalle', 50), ('Propuesta de solución', 60)]
            fill_h = PatternFill('solid', fgColor='F87171')
            for col, (h, w) in enumerate(heads, 1):
                c = ws.cell(1, col, h); c.fill = fill_h; c.font = font_h
                c.alignment = Alignment(horizontal='center')
                c.border = border
                ws.column_dimensions[get_column_letter(col)].width = w
            ws.row_dimensions[1].height = 22
            ws.freeze_panes = 'A2'
            for i, inc in enumerate(incoherencias, 2):
                cli = inc['cliente']
                vals = [inc['tipo'], cli['nombre'], cli['idnoofit'], cli['email'],
                        inc['detalle'], inc['propuesta']]
                for j, v in enumerate(vals, 1):
                    ws.cell(i, j, v).border = border
            ws.auto_filter.ref = ws.dimensions

        # ─── OK (recibos a emitir, con detalle) ─────────────────────────
        ws = wb.create_sheet('OK')
        heads = [('Cliente', 30), ('idnoofit', 11), ('DNI', 13),
                 ('Cód. GP', 9), ('Categoría', 13),
                 ('Email', 28),
                 ('Cuotas', 28), ('Detalle precios', 40),
                 ('Periodicidad', 13),
                 ('Forma pago', 14), ('IBAN', 28),
                 ('# Subs', 8), ('Importe €', 12)]
        fill_h = PatternFill('solid', fgColor='2DD4A8')
        for col, (h, w) in enumerate(heads, 1):
            c = ws.cell(1, col, h); c.fill = fill_h; c.font = font_h
            c.alignment = Alignment(horizontal='center'); c.border = border
            ws.column_dimensions[get_column_letter(col)].width = w
        ws.row_dimensions[1].height = 22; ws.freeze_panes = 'A2'
        for i, c in enumerate(coherentes, 2):
            cuotas_str = ', '.join(c.get('cuotas') or [])
            # Detalle precios: "RT 2 dias: 52.50€ · I MYGYM: 55€→10€ (RT2DIAS+MYGYM)"
            detalle_partes = []
            for d in (c.get('cuotas_detalle') or []):
                cod = d.get('codigo', '?')
                pn = float(d.get('precio_normal') or 0)
                pf = float(d.get('precio_final') or 0)
                if abs(pf - pn) < 0.01 and not d.get('descuentos') and not d.get('modificaciones'):
                    detalle_partes.append(f'{cod}: {pf:.2f}€')
                else:
                    extras = ' '.join(d.get('descuentos', []) + d.get('modificaciones', []))
                    detalle_partes.append(
                        f'{cod}: {pn:.2f}€→{pf:.2f}€'
                        + (f' [{extras}]' if extras else ''))
            for mg in (c.get('modificaciones_globales') or []):
                detalle_partes.append(f'global {mg}')
            detalle_str = ' · '.join(detalle_partes)

            vals = [c['nombre'], c['idnoofit'], c.get('dni', ''),
                    c.get('codigo_gp', ''), c.get('categoria', ''),
                    c['email'],
                    cuotas_str, detalle_str,
                    c.get('periodicidad', ''),
                    c.get('forma_pago', ''), c.get('iban', ''),
                    c['subs'], c.get('importe_total', 0)]
            for j, v in enumerate(vals, 1):
                cell = ws.cell(i, j, v); cell.border = border
                if j == 13: cell.number_format = '#,##0.00 €'
                if j == 8:
                    cell.alignment = Alignment(wrap_text=False, horizontal='left')
        # Fila TOTAL (col 12 = # Subs, col 13 = Importe)
        total_row = len(coherentes) + 2
        ws.cell(total_row, 1, 'TOTAL').font = Font(bold=True)
        ws.cell(total_row, 1).fill = fill_total
        ws.cell(total_row, 12, len(coherentes)).font = Font(bold=True)
        ws.cell(total_row, 12).fill = fill_total
        cell_imp = ws.cell(total_row, 13, resumen.get('total_importe', 0))
        cell_imp.font = Font(bold=True)
        cell_imp.fill = fill_total
        cell_imp.number_format = '#,##0.00 €'
        ws.auto_filter.ref = f'A1:M{len(coherentes)+1}'

        buf = BytesIO()
        wb.save(buf); buf.seek(0)
        return send_file(buf,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'validacion_emision_{mes}.xlsx')
    except Exception as e:
        log.exception('validar_excel')
        return jsonify({'ok': False, 'error': str(e)}), 500
