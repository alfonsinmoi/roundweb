# Manual Manager · 29 de 38 · Informe — Análisis de Patrones

## Cómo llegar

Informe Asistencia → **Análisis patrones**.

> 📷 **Captura: `29_patrones_clusters.png`** — tarjetas de clusters
> generados.

## Qué muestra

Agrupa a tus clientes en **clusters** (grupos con comportamiento
parecido) usando algoritmo **K-means++** sobre 33 variables de
asistencia:

- Día semana favorito (L–D)
- Franja horaria favorita (mañana / mediodía / tarde / noche)
- Frecuencia (clases/semana media)
- Estacionalidad (mes a mes)
- Antigüedad
- …

## Tarjetas de cluster

Cada cluster muestra:

- **Nombre auto-generado** ("Madrugadores fieles", "Esporádicos
  tarde-noche", "Fin de semana"…)
- Número de clientes en el cluster
- 3 rasgos dominantes (p.ej. "L+X+V mañanas", "≥3 clases/semana",
  "antigüedad >6m")
- Botón **ℹ Info** explicando cómo se construyó

> 📷 **Captura: `29_patrones_info_modal.png`** — modal abierto al
> pulsar ℹ con detalle del cluster.

## Modal de información del cluster

Al pulsar ℹ en una tarjeta, se abre un modal explicando:

- **Cómo se ha creado** — algoritmo K-means++ con N centroides
- **Qué tienen en común** los clientes del cluster (rasgos
  dominantes con su peso)
- **Diferencias con otros clusters**
- **Recomendaciones** automáticas: qué notificación enviarles, qué
  clase nueva podría interesarles…

## Acciones

- Click en una tarjeta → lista de clientes del cluster
- Botón **📩 Notificar al cluster** — abre modal de notificación
  prefilteado a todos los clientes del cluster
- Botón **⬇ Exportar CSV**

## Tips

- Es la herramienta más potente para **diseñar campañas
  segmentadas**: en vez de mandar un push genérico a todos, mandas
  uno específico al cluster que más lo necesita.
- Re-genera los clusters cada 1–2 meses; los hábitos cambian.
- Si un cluster tiene comportamiento de "riesgo de baja" (poca
  asistencia + antigüedad alta), es oportunidad clarísima para
  intervenir.
