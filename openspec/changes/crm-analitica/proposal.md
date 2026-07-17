## Why

El núcleo operativo (reservas → visitas → revisiones) ya genera todos los datos del negocio, pero los perfiles **admin** (gestor de centro) y **superadmin** (gestor de plataforma) no tienen forma de leerlos como gestión: no saben cuánta reserva se convierte en visita, dónde se fuga el cliente (cancela, no aparece, se va), cómo de saturadas están sus salas, qué rinde cada médico ni cómo se comparan sus centros entre sí. Sin esa lectura no hay control real para captar y retener. El modelo de datos ya lo soporta (estados de cita `ATTENDED/CANCELLED/RESCHEDULED/NO_SHOW`, `cancelReason` `CLIENTE/CENTRO`, `VisitStatus.LEFT`, cadena `rescheduledFromId`, médico/sala/centro y timestamps), así que es una capa de **lectura y agregación** que aporta valor inmediato sin migración de esquema.

## What Changes

- Arquitectura en **dos capas desacopladas**: (1) una **API de analítica** que calcula y sirve los KPIs (solo lectura), y (2) un **módulo de visualización** (dashboards enriquecidos) que consume **exclusivamente** esa API. El cálculo vive en el backend; la presentación no accede a la BD.
- **API-first**: contratos estables y documentados (OpenAPI/Swagger, reutilizando el `/docs` ya existente), pensados para ser consumidos por el dashboard interno y, potencialmente, por integraciones/BI externas con API Key.
- **Embudo de conversión**: reservas → confirmadas → atendidas → visitas completadas, con desglose de fugas (canceladas por CLIENTE vs CENTRO, reprogramadas, no-show, "se fue"/`LEFT`) y sus tasas.
- **Ocupación y saturación**: ocupación de sala frente a disponibilidad real (horario + festivos) y saturación de la demanda por día/semana/mes/año.
- **Rendimiento por médico**: visitas atendidas, pacientes distintos, tasa de aptitud (`APTO/NO_APTO`) y tiempo medio en sala.
- **Comparativa entre salas y entre centros** con las mismas métricas.
- **Series temporales de volumen** (visitas y reservas por mes/año).
- **Alcance por rol**: admin ve su(s) centro(s); superadmin ve todos los centros y hace rollup/comparativa multi-tenant, respetando el aislamiento entre tenants.
- **Filtros comunes** (rango de fechas, centro, sala, médico, producto) y **exportación CSV** de cualquier vista.
- **Módulo de visualización** para tomar decisiones: dashboards enriquecidos por rol (admin = su centro; superadmin = plataforma/comparativa), con drill-down (centro → sala → médico), comparación entre periodos y **alertas por umbral** (días saturados, conversión baja, no-show alto) que señalan dónde actuar.
- Nuevos endpoints `GET /analytics/*` de solo lectura (la API) y nueva sección de web **"Analítica"** (la visualización), visibles solo para ADMIN/SUPERADMIN.

## Capabilities

### New Capabilities

- `crm-analitica`: **API de analítica** (solo lectura) para admin/superadmin: cálculo y servicio de KPIs — embudo de conversión, ocupación y saturación, rendimiento por médico, comparativa salas/centros, series de volumen, filtros comunes, alcance por rol, exportación CSV y contrato documentado (OpenAPI) consumible interna y externamente (API Key).
- `crm-dashboards`: **Módulo de visualización** orientado a decisión que consume exclusivamente la API de `crm-analitica`: dashboards enriquecidos por rol, drill-down, comparación de periodos, alertas por umbral y export/compartir.

### Modified Capabilities

<!-- Ninguna. No cambian los requisitos del `dashboard` operativo ni de otras capacidades; esta capa solo lee datos existentes. -->

## Impact

- **Código nuevo (aditivo)**: rutas `apps/api/src/routes/analytics.ts` (solo lectura) con esquema OpenAPI documentado en `/docs`, librería de agregación en `apps/api/src/lib/analytics.ts` (reutiliza `lib/availability.ts` para la disponibilidad), y módulo web de visualización `apps/web/src/app/analitica/*` (consume solo la API) + ítem de menú para ADMIN/SUPERADMIN.
- **Exposición externa opcional**: los mismos KPIs pueden servirse por la `public-api` (autenticación por API Key) para integraciones/BI; se documenta el contrato pero la activación externa es una decisión de despliegue.

### Aislamiento (garantía de independencia)

Este change es **puramente aditivo** y NO modifica el comportamiento del front ni del backend actuales:
- **No cambia** ninguna vista, flujo, componente compartido ni dato existente. Sin migración de esquema.
- **Modified Capabilities: ninguna** — no altera requisitos de `dashboard` ni de otras capacidades.
- Los **únicos** toques a archivos existentes son aditivos: (1) un ítem de menú nuevo en `apps/web/src/app-layout.tsx` (gated por rol) para acceder a la sección, y (2) el registro de la ruta nueva en `apps/api/src/routes/index.ts`. Ningún otro archivo existente se modifica.
- Si se prefiriera **cero** ediciones en archivos existentes, la sección puede quedar accesible por URL directa sin ítem de menú; se deja el ítem por usabilidad.
- **Sin migración de esquema** para el núcleo (las 11 métricas base son calculables con el modelo actual). Posibles índices opcionales de rendimiento se evalúan en `design.md`.
- **Autorización**: los endpoints exigen rol ADMIN o SUPERADMIN; tenant-scoped por la extensión de Prisma; el alcance multi-tenant de superadmin es explícito.
- **Fuera de alcance (handoff)**: la **atribución campaña→visita** ("visitas VS campañas") se difiere a la capacidad `crm-captacion`; aquí solo se muestran series de volumen que la UI puede superponer con marcas de campañas, sin inferir causalidad. La captación por canal usa `Appointment.source` como proxy hasta esa capacidad.
