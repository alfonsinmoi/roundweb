# -*- coding: utf-8 -*-
from odoo import api, fields, models


class RoundCuotaCatalogo(models.Model):
    """Espejo del catálogo de cuotas que vive en NoofitPro.

    NoofitPro es la fuente de verdad. El MCP/webhook crea o actualiza una
    entrada aquí cuando aparece una cuota nueva en NoofitPro o cuando el
    primer cliente la usa.
    """
    _name = 'round.cuota.catalogo'
    _description = 'Catálogo de cuotas (espejo NoofitPro)'
    _rec_name = 'codigo'
    _order = 'codigo'

    codigo = fields.Char(
        string='Código',
        required=True,
        index=True,
        help="Código único de la cuota en NoofitPro (ej. 'RT 1D')",
    )
    descripcion = fields.Char(string='Descripción', required=True)

    # Precios por periodicidad — espejo de la tabla NoofitPro
    precio_mensual    = fields.Monetary(string='Precio mensual',    currency_field='currency_id')
    precio_trimestral = fields.Monetary(string='Precio trimestral', currency_field='currency_id')
    precio_semestral  = fields.Monetary(string='Precio semestral',  currency_field='currency_id')
    precio_anual      = fields.Monetary(string='Precio anual',      currency_field='currency_id')
    matricula         = fields.Monetary(string='Matrícula',         currency_field='currency_id', default=0.0)

    actividades_descripcion = fields.Char(
        string='Actividades incluidas (texto)',
        help="Descripción libre de las actividades NoofitPro que abre esta cuota.",
    )

    # Producto Odoo asociado para usar en facturas
    product_id = fields.Many2one(
        'product.product',
        string='Producto Odoo',
        help="Producto que se factura cuando se aplica esta cuota.",
    )

    company_id = fields.Many2one(
        'res.company',
        string='Empresa',
        default=lambda self: self.env.company,
        required=True,
    )
    currency_id = fields.Many2one(
        'res.currency',
        related='company_id.currency_id',
        readonly=True,
    )
    activo = fields.Boolean(default=True)

    # Relaciones
    subscription_ids = fields.One2many(
        'round.subscription',
        'cuota_id',
        string='Suscripciones',
    )
    n_suscripciones_activas = fields.Integer(
        string='Suscripciones activas',
        compute='_compute_n_suscripciones',
    )

    _sql_constraints = [
        ('codigo_company_unique',
         'UNIQUE(codigo, company_id)',
         'El código de cuota debe ser único por empresa.'),
    ]

    @api.depends('subscription_ids', 'subscription_ids.estado')
    def _compute_n_suscripciones(self):
        for rec in self:
            rec.n_suscripciones_activas = len(
                rec.subscription_ids.filtered(lambda s: s.estado == 'activa')
            )

    def name_get(self):
        return [(r.id, f"[{r.codigo}] {r.descripcion}") for r in self]
