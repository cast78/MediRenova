# Design — crm-captacion

## Contexto

Extiende la capa de analítica (misma arquitectura API-first + visualización, mismos filtros/alcance/CSV/OpenAPI) con dos áreas: **captación** (altas de clientes) y **efectividad de campañas** (atribución). Se desarrolla bajo **freeze de producción** (semana de demos): fase 1 es 100% solo lectura, sin migración de la BD Neon compartida.

## Decisiones

### 1. Reutilización de la infraestructura de `crm-analitica`
Los endpoints nuevos viven en `routes/analytics.ts`, con el mismo `filtersSchema` (rango + centro/producto + alcance por rol + `format=csv`) y guard `requireRole("ADMIN")`. Los cálculos van en núcleos puros (testeables sin BD) en `lib/analytics.ts` (o `lib/captacion.ts`). La UI reutiliza el módulo `/analitica` con una pestaña **Captación**.

### 2. Captación — definiciones
- **Alta**: `Customer.createdAt` dentro del rango. Serie por día/mes/año (buckets wall-clock-Z como en analítica).
- **Canal de captación (proxy)**: `source` de la **primera cita** del cliente (`min(scheduledAt)` o `min(createdAt)` de sus `Appointment`). Si no tiene citas, canal = "Directo/Sin cita". *Limitación documentada*: es un proxy hasta tener un campo de origen explícito.
- **Nuevo vs recurrente**: en el periodo, "nuevo" = cliente cuya primera cita cae en el rango; "recurrente" = ya tenía citas antes del rango.

### 3. Atribución campaña→visita — Fase 1 (heurística, freeze-safe)
Solo lectura, sin esquema nuevo:
- Para cada `Campaign` con `sentAt` (o cada `CampaignRecipient` enviado), un destinatario cuenta como **convertido** si su cliente creó una `Appointment` con `createdAt` en `[campaign.sentAt, campaign.sentAt + ventanaDias]`.
- **Ventana** configurable (querystring `attributionWindowDays`, por defecto **30**).
- **Desambiguación (last-touch)**: si una cita cae en la ventana de varias campañas, se atribuye a la **campaña más reciente enviada antes de la cita**. Así una conversión no se cuenta dos veces.
- Métricas por campaña: `enviados`, `convertidos`, `tasaConversion`, `reservasAtribuidas`, y (si la cita derivó en visita `COMPLETED`) `visitasAtribuidas`.
- **Núcleo puro** `campaignEffectivenessFrom(campaigns, recipients, appointments, windowDays)` → testeable sin BD (ventana, last-touch, no doble conteo).

### 4. Atribución — Fase 2 (almacenada, TRAS el freeze)
Documentada como requisito futuro, **no** implementada en esta fase:
- Migración: `CampaignRecipient.convertedAt DateTime?` (+ opcional `convertedAppointmentId`).
- Hook `markCampaignConverted(tenantId, customerId)` llamado al crear cita (backoffice y magic-link), junto a `markWorkflowConverted`, que marca el/los recipient(s) recientes del cliente como convertidos (last-touch, misma ventana).
- La API de efectividad pasa a leer `convertedAt` (persistente, sin recomputar) cuando exista; mantiene el heurístico como fallback para el histórico previo a la migración.
- Se aplica **después de la semana de demos** (requiere migración sobre la Neon compartida).

### 5. Rendimiento
Consultas acotadas por el rango (tope `MAX_RANGE_DAYS` reutilizado). La atribución heurística carga: campañas del periodo (+ sus recipients) y las citas de esos clientes en la ventana; se cruza en memoria en el núcleo puro. Para volúmenes grandes se evaluará un índice o la fase 2 (persistente) como optimización natural.

## Riesgos y mitigaciones
- **Ambigüedad de atribución (varias campañas)** → last-touch definido + fase 2 para precisión.
- **Canal proxy** → documentado; se puede añadir campo de origen explícito más adelante.
- **Freeze** → fase 1 sin migración; fase 2 explícitamente diferida.

## Fuera de alcance
- Envío real de campañas (Grupo A, pospuesto por credenciales) y atribución por enlace con `campaignId` (opción C) — dependen de ese envío.
- Modelos de atribución multi-touch/ponderada; aquí last-touch.
