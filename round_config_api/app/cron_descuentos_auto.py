"""Cron diario: recalcula qué clientes cumplen las condiciones de los
descuentos automáticos del manager y refleja el match en
`descuento_asignacion` con `origen='auto_*'`.

Tipos de descuento que evaluamos:
  - varias_cuotas → cliente tiene `cuota_requerida_codigo` activa Y una de las
                    cuotas en `combo_secundarias` activas.
  - familiares   → cliente pertenece a una familia con ≥2 miembros que tienen
                    la cuota indicada activa.

Comportamiento:
  - Si un cliente cumple → INSERT o UPDATE su fila con estado='activa',
    origen='auto_xxx', auto_motivo='razón legible',
    auto_evaluado_at=NOW().
  - Si ya NO cumple (cancelaron una cuota, salieron de la familia…) → la
    fila se marca estado='cancelada' (no se borra para conservar histórico).
  - NO toca filas con origen='manual': esas son responsabilidad del operador.

Idempotente: se puede ejecutar N veces sin efectos secundarios.

Lanzado:
  - Por systemd timer round_descuentos_auto.timer (diario, antes de la
    pre-emisión mensual).
  - Manualmente vía POST /api/clientes/descuentos-auto/recalcular.
  - Internamente tras altas/cambios de cuota relevantes (idealmente).
"""
import logging
from collections import defaultdict
from .db import get_conn

log = logging.getLogger(__name__)


def _odoo():
    from .odoo_alta import OdooAlta
    o = OdooAlta(); o._connect()
    return o


def _company_id():
    from . import config as appconfig
    return getattr(appconfig, 'ODOO_COMPANY', 3) or 3


def _cargar_cuotas_activas_por_cliente(id_manager):
    """Devuelve {idnoofit: set(codigos_cuotas_activas)} leyendo
    round.subscription activas en Odoo y mapeando a partner.id_noofit."""
    try:
        o = _odoo()
        company_id = _company_id()
        subs = o._call('round.subscription', 'search_read',
            [('estado', '=', 'activa'), ('company_id', '=', company_id)],
            ['id', 'partner_id', 'cuota_id'])
        cuotas = o._call('round.cuota.catalogo', 'search_read', [],
            ['id', 'codigo'])
        cuota_codigo_by_id = {c['id']: c['codigo'] for c in cuotas}
        partner_ids = list({s['partner_id'][0] for s in subs if s.get('partner_id')})
        partners = o._call('res.partner', 'read', partner_ids, ['id', 'id_noofit'])
        partner_idn = {p['id']: p.get('id_noofit') for p in partners}
        result = defaultdict(set)
        for s in subs:
            pid = s['partner_id'][0] if s.get('partner_id') else None
            cid = s['cuota_id'][0] if s.get('cuota_id') else None
            if not pid or not cid: continue
            idn = partner_idn.get(pid)
            cod = cuota_codigo_by_id.get(cid)
            if idn and cod:
                result[str(idn)].add(cod)
        return result
    except Exception as e:
        log.exception(f'cargar cuotas activas {id_manager}: {e}')
        return {}


def _cargar_familias(id_manager):
    """Devuelve {idnoofit: set(idnoofits_de_su_familia_incluido_yo)}."""
    out = {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT familia_id, cliente_idnoofit
              FROM familia_miembro
             WHERE id_manager=%s
        """, (str(id_manager),))
        por_familia = defaultdict(list)
        for r in cur.fetchall():
            por_familia[r['familia_id']].append(r['cliente_idnoofit'])
    for fam_id, miembros in por_familia.items():
        for m in miembros:
            out[m] = set(miembros)
    return out


def _cargar_trainer_por_cliente(id_manager):
    """Devuelve {idnoofit(str): id_trainer} desde cliente_cache. Se usa para
    aplicar el scope por trainer (auditoría #28) al ASIGNAR: un descuento AUTO
    solo se asigna a clientes de su propio trainer, igual que hace la emisión
    (descuentos_apply._solo_trainer_propio). Así la ficha del cliente refleja
    exactamente lo que se cobra."""
    out = {}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id, id_trainer FROM cliente_cache
                        WHERE id_manager=%s""", (str(id_manager),))
        for r in cur.fetchall():
            out[str(r['id'])] = r['id_trainer']
    return out


def _cumple_scope_trainer(client_trainer, desc_trainer):
    """Mirror de descuentos_apply._solo_trainer_propio (auditoría #28): un
    descuento AUTO solo aplica a clientes de SU propio trainer. Si el cliente
    no tiene trainer asignado (None) NO se filtra (la emisión, con
    id_trainer_cliente=None, aplica todos)."""
    if client_trainer is None:
        return True
    return str(client_trainer) == str(desc_trainer or '')


def _upsert_asignacion_auto(cur, descuento_id, cliente_idnoofit,
                            id_manager, id_trainer, origen, motivo,
                            tomar_manuales=False):
    """Inserta o reactiva una asignación auto. Devuelve 'creada' | 'reactivada'
    | 'ya_activa' | 'ya_manual'.

    `tomar_manuales`: si True, las filas con origen='manual' se convierten a
    auto (el cron toma el control). Se usa para tipos 100% automáticos como
    `varias_cuotas`, donde una asignación manual es legacy/sin efecto real
    (la emisión recalcula al vuelo). Para familiares se deja en False
    (respeta overrides manuales del operador)."""
    cur.execute("""
        SELECT id, estado, origen FROM descuento_asignacion
         WHERE descuento_id=%s AND cliente_idnoofit=%s
    """, (descuento_id, cliente_idnoofit))
    row = cur.fetchone()
    if not row:
        cur.execute("""
            INSERT INTO descuento_asignacion
              (descuento_id, id_manager, id_trainer, cliente_idnoofit,
               estado, origen, auto_motivo, auto_evaluado_at)
            VALUES (%s, %s, %s, %s, 'activa', %s, %s, NOW())
        """, (descuento_id, str(id_manager), str(id_trainer or ''),
              str(cliente_idnoofit), origen, motivo))
        return 'creada'
    # Si existe MANUAL y NO debemos tomarla → respetarla (operador la asignó)
    if row['origen'] == 'manual' and not tomar_manuales:
        return 'ya_manual'
    # Si está activa, solo actualizar motivo + timestamp
    if row['estado'] == 'activa':
        cur.execute("""
            UPDATE descuento_asignacion
               SET auto_motivo=%s, auto_evaluado_at=NOW()
             WHERE id=%s
        """, (motivo, row['id']))
        return 'ya_activa'
    # Reactivar (auto cancelada previamente, vuelve a cumplir)
    cur.execute("""
        UPDATE descuento_asignacion
           SET estado='activa', origen=%s, auto_motivo=%s,
               auto_evaluado_at=NOW()
         WHERE id=%s
    """, (origen, motivo, row['id']))
    return 'reactivada'


def _cancelar_asignaciones_auto_obsoletas(cur, descuento_id, id_manager,
                                           cumplen_idnoofits, origenes):
    """Cancela las asignaciones que YA NO cumplen condiciones.

    `origenes`: lista de orígenes a cancelar. Para varias_cuotas se pasa
    ('auto_varias_cuotas', 'manual') porque ese tipo es automático por
    diseño — una asignación manual obsoleta debe cancelarse igual. Para
    familiares se pasa solo ('auto_familiares',) para respetar manuales."""
    if isinstance(origenes, str):
        origenes = [origenes]
    cur.execute("""
        UPDATE descuento_asignacion
           SET estado='cancelada', auto_evaluado_at=NOW(),
               auto_motivo=COALESCE(auto_motivo,'') ||
                           ' [cancelado: ya no cumple condiciones ' ||
                           NOW()::date::text || ']'
         WHERE descuento_id=%s
           AND id_manager=%s
           AND origen = ANY(%s)
           AND estado='activa'
           AND NOT (cliente_idnoofit = ANY(%s))
        RETURNING id, cliente_idnoofit
    """, (descuento_id, str(id_manager), list(origenes),
          list(cumplen_idnoofits) if cumplen_idnoofits else ['__none__']))
    return cur.fetchall() or []


def recalcular_descuentos_auto(id_manager):
    """Punto de entrada principal. Devuelve dict con contadores."""
    stats = {'manager': str(id_manager),
             'varias_cuotas': {'evaluados': 0, 'creados': 0, 'reactivados': 0,
                               'ya_activos': 0, 'ya_manuales': 0, 'cancelados': 0},
             'familiares':    {'evaluados': 0, 'creados': 0, 'reactivados': 0,
                               'ya_activos': 0, 'ya_manuales': 0, 'cancelados': 0},
             'errores': []}

    cuotas_por_idn = _cargar_cuotas_activas_por_cliente(id_manager)
    familias = _cargar_familias(id_manager)
    trainer_por_idn = _cargar_trainer_por_cliente(id_manager)  # scope #28

    with get_conn() as conn, conn.cursor() as cur:
        # ── varias_cuotas ──────────────────────────────────────────────
        cur.execute("""
            SELECT id, codigo, cuota_requerida_codigo, combo_secundarias,
                   id_trainer
              FROM descuento
             WHERE id_manager=%s AND tipo='varias_cuotas' AND active=TRUE
        """, (str(id_manager),))
        descs_varias = cur.fetchall() or []

        for d in descs_varias:
            req = (d.get('cuota_requerida_codigo') or '').strip()
            if not req: continue
            cs = d.get('combo_secundarias') or []
            if isinstance(cs, str):
                try:
                    import json as _j
                    cs = _j.loads(cs)
                except Exception:
                    cs = []
            sec_codes = [s.get('cuota_codigo') for s in (cs or [])
                         if s.get('cuota_codigo')]
            cumplen = []
            for idn, codigos in cuotas_por_idn.items():
                if req not in codigos: continue
                # Necesita ≥1 secundaria activa también
                if not any(sc in codigos for sc in sec_codes): continue
                # Scope por trainer (#28): solo clientes del propio trainer del
                # descuento (manager-wide/NULL no asigna a nadie, como la emisión).
                if not _cumple_scope_trainer(trainer_por_idn.get(idn),
                                             d.get('id_trainer')):
                    continue
                cumplen.append(idn)
                stats['varias_cuotas']['evaluados'] += 1
                motivo = (f'Cumple "{d["codigo"]}": tiene cuota requerida '
                          f'"{req}" + secundaria(s) ' +
                          ', '.join(sc for sc in sec_codes if sc in codigos))
                res = _upsert_asignacion_auto(
                    cur, d['id'], idn, id_manager, d.get('id_trainer'),
                    'auto_varias_cuotas', motivo, tomar_manuales=True)
                if res in ('creada', 'reactivada', 'ya_activa', 'ya_manual'):
                    key = res if res in stats['varias_cuotas'] else res
                    if res == 'creada': stats['varias_cuotas']['creados'] += 1
                    elif res == 'reactivada': stats['varias_cuotas']['reactivados'] += 1
                    elif res == 'ya_activa': stats['varias_cuotas']['ya_activos'] += 1
                    elif res == 'ya_manual': stats['varias_cuotas']['ya_manuales'] += 1
            # Cancelar las obsoletas — incluye manuales legacy (varias_cuotas
            # es automático por diseño, no hay manuales legítimas que respetar).
            cancelados = _cancelar_asignaciones_auto_obsoletas(
                cur, d['id'], id_manager, cumplen,
                ['auto_varias_cuotas', 'manual'])
            stats['varias_cuotas']['cancelados'] += len(cancelados)

        # ── familiares ────────────────────────────────────────────────
        cur.execute("""
            SELECT id, codigo, combo_secundarias, id_trainer
              FROM descuento
             WHERE id_manager=%s AND tipo='familiares' AND active=TRUE
        """, (str(id_manager),))
        descs_fam = cur.fetchall() or []

        for d in descs_fam:
            cs = d.get('combo_secundarias') or []
            if isinstance(cs, str):
                try:
                    import json as _j
                    cs = _j.loads(cs)
                except Exception:
                    cs = []
            cumplen = []
            # Para cada combo: cuota_codigo necesita ≥2 miembros familia con esa cuota
            for s in (cs or []):
                cuota_obj = s.get('cuota_codigo')
                if not cuota_obj: continue
                for idn, familia in familias.items():
                    # ¿él tiene la cuota?
                    cuotas_idn = cuotas_por_idn.get(idn, set())
                    if cuota_obj not in cuotas_idn: continue
                    # ¿hay ≥2 miembros (incluido él) con la cuota?
                    n_con_cuota = sum(
                        1 for m in familia
                        if cuota_obj in cuotas_por_idn.get(m, set()))
                    if n_con_cuota < 2: continue
                    if idn in cumplen: continue   # mismo desc para mismo cli
                    # Scope por trainer (#28): solo clientes del propio trainer
                    # del descuento (igual que la emisión).
                    if not _cumple_scope_trainer(trainer_por_idn.get(idn),
                                                 d.get('id_trainer')):
                        continue
                    cumplen.append(idn)
                    stats['familiares']['evaluados'] += 1
                    motivo = (f'Cumple "{d["codigo"]}": cuota "{cuota_obj}" '
                              f'con {n_con_cuota} miembro(s) en su familia '
                              f'({len(familia)} miembros total)')
                    res = _upsert_asignacion_auto(
                        cur, d['id'], idn, id_manager, d.get('id_trainer'),
                        'auto_familiares', motivo)
                    if res == 'creada': stats['familiares']['creados'] += 1
                    elif res == 'reactivada': stats['familiares']['reactivados'] += 1
                    elif res == 'ya_activa': stats['familiares']['ya_activos'] += 1
                    elif res == 'ya_manual': stats['familiares']['ya_manuales'] += 1
            cancelados = _cancelar_asignaciones_auto_obsoletas(
                cur, d['id'], id_manager, cumplen, 'auto_familiares')
            stats['familiares']['cancelados'] += len(cancelados)

    return stats


def recalcular_todos_managers():
    """Itera todos los managers activos y recalcula para cada uno."""
    out = []
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""SELECT id_manager FROM manager_config
                        WHERE activo=TRUE
                          AND COALESCE(odoo_cuotas_enabled, FALSE) = TRUE""")
        managers = [r['id_manager'] for r in cur.fetchall()]
    for mgr in managers:
        try:
            out.append(recalcular_descuentos_auto(mgr))
        except Exception as e:
            log.exception(f'recalcular {mgr}: {e}')
            out.append({'manager': mgr, 'error': str(e)})
    return out


if __name__ == '__main__':
    # Modo CLI para que el systemd timer lo dispare:
    #   python -m app.cron_descuentos_auto
    import json
    logging.basicConfig(level=logging.INFO)
    r = recalcular_todos_managers()
    print(json.dumps(r, indent=2))
