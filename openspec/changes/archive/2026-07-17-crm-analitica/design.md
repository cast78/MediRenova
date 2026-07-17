# Design — crm-analitica

## Contexto y objetivo

Capa de **solo lectura** que agrega datos ya existentes para admin/superadmin. No introduce entidades nuevas ni cambia el flujo operativo. Prioridad: correctitud de las definiciones de métrica y aislamiento por tenant/rol; el rendimiento se resuelve con `groupBy` sobre índices existentes y se optimiza sólo si hace falta.

## Arquitectura en dos capas (API-first)

El principio rector es **desacoplar cálculo de presentación**:

- **Capa 1 — API de analítica (`crm-analitica`)**: única responsable de calcular los KPIs y servirlos. Contratos **estables y versionables**, documentados con **OpenAPI/Swagger** en el `/docs` ya existente. Es la **fuente única** de los números: cualquier consumidor (dashboard interno, integración externa, export) obtiene los mismos valores por el mismo endpoint. Autenticación por JWT (interno, ADMIN/SUPERADMIN) y, opcionalmente, por **API Key** vía `public-api` para BI/integraciones externas.
- **Capa 2 — Visualización (`crm-dashboards`)**: dashboards enriquecidos que **consumen exclusivamente la API** (no hay consultas a BD desde el frontend ni lógica de métrica duplicada). Su valor es la lectura para decidir: comparación, drill-down y señalización de problemas.

Beneficio: la definición de cada KPI vive en un solo sitio (testeable), y podemos cambiar/añadir visualizaciones sin tocar el cálculo, o exponer los KPIs a terceros sin reescribir nada.

## Decisiones

### 1. Endpoints de solo lectura bajo `/analytics/*`
- Todos `GET`, sin efectos secundarios. Autorización: `requireAnyRole(["ADMIN", "SUPERADMIN"])`.
- Contrato uniforme de respuesta `{ data, errors }` como el resto de la API.
- Endpoints previstos (uno por vista, para poder cargarlos de forma independiente en la UI):
  - `GET /analytics/funnel` — embudo + fugas.
  - `GET /analytics/occupancy` — ocupación por sala/centro vs disponibilidad.
  - `GET /analytics/saturation` — saturación temporal (serie por día/semana/mes).
  - `GET /analytics/doctors` — rendimiento por médico.
  - `GET /analytics/comparison` — comparativa entre salas y entre centros.
  - `GET /analytics/volume` — series de volumen (visitas/reservas por mes/año).
  - Cada uno acepta `?format=csv` para exportar la misma consulta.

### 2. Filtros comunes (querystring)
`from`, `to` (YYYY-MM-DD, obligatorio el rango), `centerId?`, `roomId?`, `doctorId?`, `productId?`, `granularity?` (`day|week|month|year`, según endpoint). Validación con Zod. Rango máximo acotado (p. ej. 2 años) para proteger la BD.

### 3. Alcance por rol (aislamiento)
- **ADMIN**: consultas siempre acotadas a su tenant (lo inyecta la extensión de Prisma) y, si el admin está ligado a centros concretos (`UserCenter`), a esos centros por defecto.
- **SUPERADMIN**: puede consultar **cross-tenant**. El alcance se hace **explícito** por parámetro (`scope=all` para rollup de plataforma, o `tenantId=<id>` para un tenant concreto), reutilizando el mecanismo `x-act-as-tenant` ya existente. Nunca se mezclan datos de tenants sin que el superadmin lo pida explícitamente.
- El desglose por tenant sólo aparece cuando el solicitante es SUPERADMIN.

### 4. Definiciones de métrica (fuente de verdad)
Para evitar ambigüedad al implementar y testear:
- **Reservas del periodo**: `Appointment` con `scheduledAt` en `[from, to]`.
- **Atendidas**: `Appointment.status = ATTENDED` (equivalente a visita `COMPLETED`).
- **Canceladas**: `status = CANCELLED`; se subdividen por `cancelReason` (`CLIENTE` = oportunidad de recaptura, `CENTRO` = problema operativo; `DUPLICADA/ERROR` se **excluyen** de las tasas por ser ruido).
- **Reprogramadas**: `status = RESCHEDULED` (la cita "fantasma" original). La cita nueva se cuenta aparte por su propio estado; **no** se cuenta dos veces.
- **No-show**: `status = NO_SHOW`.
- **"Se fue"**: `Visit.status = LEFT`.
- **Ocupación**: minutos-slot usados / minutos-slot disponibles. *Disponibles* = suma de la ventana del `Room.schedule` en el periodo menos festivos del centro (se reutiliza `lib/availability.ts`). *Usados* = suma de `durationMinutes` de citas no canceladas/no-show (o de visitas, configurable) que caen en esa sala/periodo.
- **Saturación**: demanda (reservas) frente a capacidad (slots disponibles) por bucket temporal; un bucket "saturado" supera un umbral (p. ej. ≥90 %).
- **Tasa de aptitud** por médico: `APTO / (APTO + NO_APTO)` sobre revisiones completadas.
- **Tiempo medio en sala**: media de `completedAt − startedAt` de visitas completadas.

### 5. Zona horaria y buckets
El bucketing por día/mes usa **Europe/Madrid** para ser coherente con el "wall-clock naive" del resto del sistema. Se calcula con `date_trunc` en SQL con timezone explícito (o en app tras traer filas ligeras), no con UTC crudo, para que "un día" case con el día natural del centro.

### 6. Rendimiento
- Consultas de agregación con `groupBy`/`count`/`aggregate` de Prisma; se apoyan en los índices existentes (`(tenantId, scheduledAt)`, `(tenantId, status)`, `(roomId, scheduledAt)`, visitas `(tenantId, arrivedAt)`, `(tenantId, centerId, status)`).
- **Sin vistas materializadas** en esta fase. Si algún endpoint resultara lento con datos reales, se evalúa: (a) índice adicional `visits(completedAt)` o `(tenantId, status, completedAt)`, (b) capa de caché por (tenant, filtros, día). Ambas quedan como optimización opcional, no bloqueante.

### 7. Frontend — módulo de visualización (`crm-dashboards`)
- Nueva sección `apps/web/src/app/analitica/` (App Router), visible sólo para ADMIN/SUPERADMIN (ítem de menú nuevo en `app-layout.tsx`). **Consume solo la API** de analítica vía el proxy; sin lógica de métrica en el cliente.
- Barra de filtros común (rango + centro/sala/médico/producto) que persiste en la URL (`useSearchParams`), como ya se hace en otras vistas.
- Gráficos con la misma librería que el dashboard actual; tablas de comparativa; botón de exportar CSV que reusa el endpoint con `?format=csv`.
- **Orientación a decisión**: comparación entre periodos (p. ej. este mes vs anterior), **drill-down** (centro → sala → médico reusando los filtros) y **alertas por umbral** (resalta días saturados, conversión por debajo de objetivo, no-show alto) para que el gestor vea de un vistazo dónde actuar.
- SUPERADMIN ve un selector de alcance (plataforma / tenant concreto) que mapea a `scope`/`tenantId`, y una vista de **comparativa entre centros/tenants**.
- La página de inicio de la sección es un **dashboard resumen** (tarjetas de KPIs clave + alertas); cada tarjeta enlaza a su vista detallada.

## Riesgos y mitigaciones
- **Definiciones ambiguas** → se fijan arriba y se cubren con tests por escenario del spec.
- **Consultas pesadas** → rango acotado + índices existentes; optimización diferida y medible.
- **Fuga entre tenants (superadmin)** → alcance cross-tenant siempre explícito; tests de aislamiento.

## Fuera de alcance
- Atribución causal campaña→visita (va en `crm-captacion`).
- Persistencia de informes programados / envío por email (posible fase posterior).
- Predicción/forecast; aquí sólo histórico y estado actual.
