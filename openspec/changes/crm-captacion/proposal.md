## Why

Tras la analítica de gestión, el siguiente control CRM que falta es el de **captación y retorno comercial**: los admin/superadmin no pueden ver cuántos clientes nuevos entran (ni por qué canal) ni si sus **campañas comerciales convierten en visitas**. Esto último quedó deliberadamente fuera de `crm-analitica` porque requiere atribución. El modelo ya tiene las señales necesarias (`Customer.createdAt`, `Appointment.source`, `CampaignRecipient.sentAt`), y el patrón de atribución ya existe para el workflow de caducidades (`markWorkflowConverted`), así que se puede resolver de forma incremental.

## What Changes

- **Altas de clientes por periodo y canal**: nuevos clientes (`Customer.createdAt`) agregados por día/mes/año, con desglose por canal de captación (proxy: `source` de su primera cita — `BACKOFFICE / MAGIC_LINK / API / WALK_IN`).
- **Clientes nuevos vs recurrentes** en el periodo.
- **Efectividad de campañas (atribución campaña→visita)** en **dos fases**:
  - **Fase 1 (freeze-safe, solo lectura)**: atribución **heurística por ventana** — un destinatario (`CampaignRecipient.sentAt`) cuenta como convertido si el cliente creó una cita dentro de N días (ventana configurable, last-touch). Sin cambios de esquema ni migración.
  - **Fase 2 (tras el freeze de demos)**: atribución **almacenada** — nuevo `CampaignRecipient.convertedAt` + hook `markCampaignConverted` al crear cita (misma forma que `markWorkflowConverted`), para precisión y persistencia. Requiere migración.
- **API-first** (misma arquitectura que `crm-analitica`): endpoints de solo lectura `GET /analytics/acquisition` y `GET /analytics/campaign-effectiveness`, con los filtros/alcance por rol/CSV/OpenAPI ya establecidos.
- **Visualización**: nueva vista **Captación** en el módulo `/analitica` que consume solo la API (embudo de captación + tabla de efectividad/ROI por campaña).

## Capabilities

### New Capabilities

- `crm-captacion`: Captación de clientes (altas por periodo/canal, nuevos vs recurrentes) y efectividad de campañas (atribución campaña→visita: fase 1 heurística freeze-safe, fase 2 almacenada), expuesta como API de solo lectura y consumida por una vista de visualización.

### Modified Capabilities

<!-- Ninguna requerida en fase 1. La fase 2 (atribución almacenada) tocará el modelo de
CampaignRecipient, pero se especifica aquí como requisito futuro; no modifica requisitos
de capacidades existentes. -->

## Impact

- **Fase 1 (freeze-safe, esta fase)**: solo código aditivo — `lib/analytics.ts` (o `lib/captacion.ts`) con núcleos puros de captación/atribución heurística, 2 endpoints nuevos en `routes/analytics.ts`, y una vista nueva en `apps/web/src/app/analitica/`. **Sin migración** (respeta el freeze de producción / BD Neon compartida).
- **Fase 2 (tras el freeze)**: migración `CampaignRecipient.convertedAt` + hook en el alta de citas (`appointments.ts`, `magic-link.ts`, junto a `markWorkflowConverted`). No se aplica durante la semana de demos.
- **Limitaciones conocidas** (documentadas): el canal de captación es un proxy (primera cita); la atribución heurística es last-touch y puede ser ambigua si varias campañas caen en la misma ventana — la fase 2 lo resuelve.
- Autorización y aislamiento por tenant idénticos a `crm-analitica` (ADMIN/SUPERADMIN, superadmin cross-tenant explícito).
