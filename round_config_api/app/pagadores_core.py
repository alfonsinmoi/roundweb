"""Resolución del instrumento de cobro de un cliente (figura Pagador).

docs/PLAN_PAGADOR.md. Un cliente puede tener un PAGADOR activo que cede su
instrumento (IBAN si SEPA / token si tarjeta). En ese caso, al generar el
adeudo se debita el instrumento del PAGADOR — pero la factura/recibo siguen
siendo del cliente (Odoo intacto).

Este módulo NO importa nada de Flask/routes → seguro de importar desde la
emisión (`odoo_cuotas`) sin ciclos. F1 lo define; F3 lo cablea en `emitir_remesa`.
"""
import logging
from .db import get_conn

log = logging.getLogger(__name__)


def pagador_activo_de(id_manager, cliente_idnoofit):
    """Devuelve la fila `pagador` activa que paga a este cliente, o None.

    Cruza `pagador_cliente` (estado='activo') → `pagador` (estado='activo').
    """
    if not cliente_idnoofit:
        return None
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT p.*
              FROM pagador_cliente pc
              JOIN pagador p ON p.id = pc.pagador_id
             WHERE pc.id_manager = %s
               AND pc.cliente_idnoofit = %s
               AND pc.estado = 'activo'
               AND p.estado = 'activo'
             LIMIT 1
        """, (str(id_manager), str(cliente_idnoofit)))
        return cur.fetchone()


def _mandato_ok(p):
    """¿El pagador tiene instrumento utilizable para cobrar?"""
    if p.get('forma_pago') == 'sepa':
        return bool(p.get('mandate_ref') or p.get('odoo_mandate_id'))
    if p.get('forma_pago') == 'tarjeta_token':
        return bool(p.get('card_token'))
    return False


def instrumento_de_cobro(id_manager, cliente_idnoofit):
    """Resuelve CON QUÉ se cobra a un cliente.

    Devuelve dict:
      {
        'origen': 'pagador' | 'cliente',
        'forma_pago': str | None,
        'pagador_id': int | None,
        'pagador_nombre': str | None,
        # SEPA:
        'iban', 'mandate_ref', 'odoo_bank_id', 'odoo_mandate_id',
        # tarjeta:
        'card_token', 'card_last4',
        'instrumento_ok': bool,   # hay con qué cobrar (mandato/token presente)
      }

    Regla: si el cliente tiene PAGADOR activo → instrumento del pagador.
    Si no → su `forma_pago_cliente` activa (auto-pago, comportamiento actual).
    """
    p = pagador_activo_de(id_manager, cliente_idnoofit)
    if p:
        return {
            'origen': 'pagador',
            'forma_pago': p.get('forma_pago'),
            'pagador_id': p.get('id'),
            'pagador_nombre': p.get('nombre'),
            'iban': p.get('iban'),
            'mandate_ref': p.get('mandate_ref'),
            'odoo_bank_id': p.get('odoo_bank_id'),
            'odoo_mandate_id': p.get('odoo_mandate_id'),
            'card_token': p.get('card_token'),
            'card_last4': p.get('card_last4'),
            'instrumento_ok': _mandato_ok(p),
        }
    # Auto-pago: forma_pago_cliente activa del propio cliente.
    fp = forma_pago_cliente_activa(id_manager, cliente_idnoofit)
    return {
        'origen': 'cliente',
        'forma_pago': (fp or {}).get('forma_pago'),
        'pagador_id': None,
        'pagador_nombre': None,
        'iban': (fp or {}).get('iban'),
        'mandate_ref': (fp or {}).get('mandate_ref'),
        'odoo_bank_id': None,
        'odoo_mandate_id': None,
        'card_token': (fp or {}).get('card_token'),
        'card_last4': (fp or {}).get('card_last4'),
        'instrumento_ok': bool(fp),
    }


def forma_pago_cliente_activa(id_manager, cliente_idnoofit):
    """Forma de pago propia (auto-pago) activa del cliente, o None.

    Usado por el endpoint de baja para informar "la forma de pago que queda"
    cuando se retira el cliente de un pagador (decisión 4)."""
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT forma_pago, iban, mandate_ref, card_token, card_last4
              FROM forma_pago_cliente
             WHERE id_manager = %s AND cliente_idnoofit = %s AND estado = 'activa'
             LIMIT 1
        """, (str(id_manager), str(cliente_idnoofit)))
        return cur.fetchone()
