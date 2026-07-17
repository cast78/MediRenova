## 1. Núcleos puros de cálculo (`lib/analytics.ts`)

- [x] 1.1 `acquisitionFrom(customers, firstApptSourceByCustomer, granularity)`: altas por bucket + desglose por canal (proxy primera cita) + "sin cita"
- [x] 1.2 `newVsReturningFrom(...)`: nuevos (primera cita en rango) vs recurrentes
- [x] 1.3 `campaignEffectivenessFrom(campaigns, recipients, appointments, windowDays)`: convertidos por ventana, last-touch sin doble conteo, reservas y visitas atribuidas
- [x] 1.4 Tests unitarios de los núcleos (ventana dentro/fuera, last-touch, sin doble conteo, canal "sin cita")

## 2. Consultas y endpoints (`routes/analytics.ts`)

- [ ] 2.1 `computeAcquisition(scope, filtros)`: carga clientes del rango + primera cita/canal; delega en el núcleo
- [ ] 2.2 `computeCampaignEffectiveness(scope, filtros, windowDays)`: carga campañas+recipients+citas de la ventana; delega en el núcleo
- [ ] 2.3 `GET /analytics/acquisition` (reusa filtros/alcance/CSV)
- [ ] 2.4 `GET /analytics/campaign-effectiveness` (+ `attributionWindowDays`, por defecto 30)
- [ ] 2.5 Documentar ambos en OpenAPI (`/docs`, Bearer)

## 3. Pruebas de API

- [ ] 3.1 Alcance: admin acotado a su tenant; DOCTOR/RECEPTIONIST → 403
- [ ] 3.2 Efectividad: conversión dentro/fuera de ventana; ventana personalizada; consistencia JSON/CSV

## 4. Frontend — vista Captación (en `/analitica`)

- [ ] 4.1 Añadir pestaña "Captación" al módulo de analítica (consume solo la API)
- [ ] 4.2 Altas por periodo + desglose por canal (gráfico) y nuevos vs recurrentes
- [ ] 4.3 Tabla de efectividad de campañas (enviados, convertidos, tasa, reservas/visitas atribuidas) + selector de ventana + export CSV

## 5. Verificación (fase 1, freeze-safe)

- [ ] 5.1 `tsc --noEmit` (api + web) y build limpios
- [ ] 5.2 Suite de tests en verde (incluye los núcleos nuevos)
- [ ] 5.3 Smoke local de los 2 endpoints con datos del seed (sin tocar prod ni migrar)

## 6. Fase 2 — atribución almacenada (TRAS el freeze de demos)

- [ ] 6.1 Migración `CampaignRecipient.convertedAt` (+ opcional `convertedAppointmentId`)
- [ ] 6.2 `markCampaignConverted(tenantId, customerId)` + llamada en alta de cita (`appointments.ts`, `magic-link.ts`)
- [ ] 6.3 La API de efectividad usa `convertedAt` persistido (heurístico como fallback del histórico)
- [ ] 6.4 Aplicar migración en Neon y desplegar (fuera del periodo de demos)
