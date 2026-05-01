# -*- coding: utf-8 -*-
from odoo import api, fields, models


class ResPartner(models.Model):
    """Extensión del cliente para integración con NoofitPro."""
    _inherit = 'res.partner'

    id_noofit = fields.Char(
        string='ID NoofitPro',
        index=True,
        help="ID estable del cliente en NoofitPro. Usado para sincronizar.",
    )

    trainer_analytic_id = fields.Many2one(
        'account.analytic.account',
        string='Trainer / Centro asignado',
        help="Etiqueta analítica del trainer al que está asignado el cliente. "
             "Define qué pasarela de pago se usará para sus cobros.",
    )

    estado_facturacion = fields.Selection(
        [('activo',     'Activo'),
         ('suspendido', 'Suspendido por impago'),
         ('baja',       'Baja')],
        string='Estado facturación',
        default='activo',
        tracking=True,
    )

    fecha_baja_facturacion = fields.Date(string='Fecha baja')

    # Suscripciones del cliente
    round_subscription_ids = fields.One2many(
        'round.subscription',
        'partner_id',
        string='Suscripciones Round',
    )
    round_subscription_count = fields.Integer(
        compute='_compute_round_subscription_count',
        string='Nº suscripciones',
    )

    @api.depends('round_subscription_ids')
    def _compute_round_subscription_count(self):
        for rec in self:
            rec.round_subscription_count = len(rec.round_subscription_ids)

    def action_view_subscriptions(self):
        self.ensure_one()
        return {
            'name': f'Suscripciones de {self.name}',
            'type': 'ir.actions.act_window',
            'res_model': 'round.subscription',
            'view_mode': 'tree,form',
            'domain': [('partner_id', '=', self.id)],
            'context': {'default_partner_id': self.id},
        }
