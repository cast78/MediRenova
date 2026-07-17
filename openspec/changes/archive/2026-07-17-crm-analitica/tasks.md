## 1. Contratos y andamiaje (backend)

- [x] 1.1 Definir los tipos de respuesta de cada informe (funnel, occupancy, saturation, doctors, comparison, volume) en `apps/api/src/routes/analytics.ts`
- [x] 1.2 Definir el schema Zod de filtros comunes (`from`, `to`, `centerId?`, `roomId?`, `doctorId?`, `productId?`, `granularity?`) con validación de rango máximo
- [x] 1.3 Registrar la ruta `analytics` con `requireAnyRole(["ADMIN","SUPERADMIN"])` en `routes/index.ts`
- [x] 1.4 Implementar la resolución de alcance por rol (admin→su tenant/centros; superadmin→`scope=all` o `tenantId`) reutilizando `x-act-as-tenant`

## 2. Librería de agregación (`lib/analytics.ts`)

- [x] 2.1 Helper de bucketing temporal en Europe/Madrid (`day|week|month|year`)
- [x] 2.2 `computeFunnel(filtros)`: reservas→confirmadas→atendidas→visitas + fugas (canceladas por motivo, reprogramadas contadas una vez, no-show, `LEFT`) y tasas; excluir `DUPLICADA/ERROR`
- [x] 2.3 `computeOccupancy(filtros)`: minutos usados / disponibles por sala reutilizando `lib/availability.ts` (horario + festivos), excluyendo salas inactivas
- [x] 2.4 `computeSaturation(filtros)`: serie demanda vs capacidad por bucket + marca de saturado según umbral
- [x] 2.5 `computeDoctors(filtros)`: visitas atendidas, pacientes distintos, tasa de aptitud (sin dividir por cero), tiempo medio en sala
- [x] 2.6 `computeComparison(filtros)`: mismas métricas por sala (dentro de centro) y por centro (dentro de alcance)
- [x] 2.7 `computeVolume(filtros)`: series de visitas y reservas por mes/año
- [x] 2.8 Serializador CSV compartido para todas las vistas (`format=csv`)

## 3. Endpoints

- [x] 3.1 `GET /analytics/funnel`
- [x] 3.2 `GET /analytics/occupancy`
- [x] 3.3 `GET /analytics/saturation`
- [x] 3.4 `GET /analytics/doctors`
- [x] 3.5 `GET /analytics/comparison`
- [x] 3.6 `GET /analytics/volume`
- [x] 3.7 Soporte `?format=csv` en todos ellos
- [x] 3.8 Documentar los endpoints en OpenAPI/Swagger (`/docs`): parámetros de filtro y esquema de respuesta
- [ ] 3.9 (Opcional) Exponer los KPIs por `public-api` con autenticación por API Key, respetando el aislamiento por tenant

## 4. Pruebas de API

- [x] 4.1 Tests de embudo: tasas correctas, cancelaciones por motivo, reprogramación no duplicada, `LEFT` como fuga
- [x] 4.2 Tests de ocupación: exclusión de festivos/horario y de salas inactivas
- [x] 4.3 Tests de saturación: umbral y granularidades
- [x] 4.4 Tests de médicos: tasa de aptitud sin división por cero, médico sin actividad
- [x] 4.5 Tests de alcance: admin acotado a su tenant; superadmin `scope=all` vs `tenantId`; DOCTOR/RECEPTIONIST reciben 403
- [x] 4.6 Tests de filtros: combinación de filtros y rechazo de rango inválido/excesivo
- [x] 4.7 Tests de consistencia: mismo KPI+filtros devuelve los mismos valores por JSON y por CSV (fuente única)
- [ ] 4.8 (Si 3.9) Tests de API Key: consumo externo devuelve sólo datos del tenant de la key; key inválida/sin permiso → 401/403

## 5. Frontend — módulo de visualización (`crm-dashboards`)

- [x] 5.1 Añadir ítem de menú "Analítica" en `app-layout.tsx` visible sólo para ADMIN/SUPERADMIN
- [x] 5.2 Cliente de la API de analítica en el frontend (consume solo endpoints; sin lógica de métrica en cliente) + barra de filtros común persistida en URL (rango, centro, sala, médico, producto)
- [x] 5.3 Selector de alcance para SUPERADMIN (plataforma / tenant concreto)
- [x] 5.4 Dashboard resumen (tarjetas de KPIs clave + alertas activas, cada tarjeta enlaza a su detalle)
- [x] 5.5 Alertas por umbral (días saturados, conversión bajo objetivo, no-show alto) resaltadas con su ámbito
- [x] 5.6 Comparación con periodo de referencia (actual vs anterior) con variación por KPI
- [x] 5.7 Drill-down por ámbito (centro → sala → médico) reutilizando filtros
- [x] 5.8 Vista Embudo (etapas + fugas + tasas)
- [x] 5.9 Vista Ocupación y Saturación (gráfico temporal + días saturados)
- [x] 5.10 Vista Rendimiento por médico (tabla + aptitud + tiempo en sala)
- [x] 5.11 Vista Comparativa salas/centros (tabla comparativa)
- [x] 5.12 Vista Volumen (series mensuales/anuales de visitas y reservas)
- [x] 5.13 Botón "Exportar CSV" en cada vista (reusa el endpoint con `format=csv`)

## 6. Verificación

- [x] 6.1 `pnpm --filter api exec tsc --noEmit` y `pnpm --filter web exec tsc --noEmit` sin errores
- [x] 6.2 `next build` (web) y `tsc -p tsconfig.json` (api) sin errores de lint/tipos
- [x] 6.3 Smoke test de los 6 endpoints con los 3 roles y datos del seed (admin ve datos; doctor/recepción 403)
- [x] 6.4 Revisar definiciones de métrica contra los escenarios del spec con datos reales del seed
