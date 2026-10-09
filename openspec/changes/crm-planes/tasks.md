Rama: `feat/crm-planes` desde `main`, PRs pequeños y frecuentes. Cada fase es desplegable sola: con todas las empresas en Pro por defecto, nada cambia en producción hasta asignar planes.

## P1. Modelo y núcleo

- [x] P1.1 Migración: `enum PlanTier`, `Tenant.plan @default(PRO)`, `trialUntil`, `featureOverrides` (Json), `maxCenters`; tabla `PlanRequest`
- [x] P1.2 `lib/plan.ts`: catálogo `FEATURES` (clave, plan mínimo, etiqueta, `requires`), `effectivePlan`, `features`, `hasFeature` (puros)
- [x] P1.3 Tests del núcleo: plan × prueba (activa/vencida) × overrides (add/remove) × dependencias
- [x] P1.4 `requireFeature(key)` en `lib/authorization.ts` con cache por tenant (60 s) y `403 FEATURE_NOT_IN_PLAN`
- [x] P1.5 `GET /tenants/me` devuelve `plan`, `effectivePlan`, `trialUntil`, `features[]`, `centersCount`, `maxCenters`
- [x] P1.6 Seed: contraseña del superadmin desde `SUPERADMIN_PASSWORD` (+ `.env.example`); segunda empresa demo "Clínica Esencial" en plan Esencial

## P2. Guardias en la API y crons

- [x] P2.1 Aplicar `requireFeature` por módulo: campañas, segmentos, plantillas (`campaigns`); workflow (`workflow`); analítica pro (`analytics_pro`); captación (`captacion`); deliveries y `/customers/:id/deliveries` (`messaging`); no-shows y recovery (`recovery`); api-keys (`api_public`); channels y campos Meta del PATCH config (`channels`)
- [x] P2.2 Rutas públicas: `/public/v1/*` y `/link/:token/confirm|reschedule` → `public_booking`; `/portal/appointments` → `portal_full` (resolviendo el tenant del token/clave)
- [x] P2.3 `notify` devuelve `null` sin `messaging`; `createConfirmLink`/`createBookingLink` siguen disponibles para los botones manuales
- [x] P2.4 Crons: `runWorkflowJob` y `runDueCampaigns` filtran por función
- [x] P2.5 `POST /centers` → `409 MAX_CENTERS_REACHED` si `maxCenters` alcanzado
- [x] P2.6 Test de cobertura: toda ruta de módulo Pro tiene guardia (lista explícita) y toda clave usada existe en `FEATURES`
- [x] P2.7 `POST /tenants/me/plan-request` (ADMIN): crea `PlanRequest` y envía email al proveedor

## P3. Frontend de la clínica

- [x] P3.1 `useFeatures()` + `features` en el tipo de `/tenants/me`
- [x] P3.2 Menú: ítems con `feature`; sin ella, icono de candado y navegación a la página bloqueada
- [x] P3.3 Componente `LockedModule` (título, beneficios, dato propio si existe, botón "Quiero pasar a Pro" → petición + confirmación)
- [x] P3.4 Envolver cada módulo Pro: Campañas, Workflow, Analítica (parte pro), Captación, Recuperar (pestaña), Comunicaciones (pestaña ficha + Configuración), Canales, API; Reservas/ficha ocultan acciones Pro con tooltip "Disponible en Pro"
- [x] P3.5 Configuración → tarjeta **"Tu plan"**: plan, prueba, centros/límite, incluye/no incluye, botón de petición, historial (auditoría)
- [x] P3.6 Portal: sin `portal_full` se ocultan citas y renovación
- [ ] P3.7 Manejo global del `403 FEATURE_NOT_IN_PLAN` en `apiFetch` (mensaje claro, no "Error 403")

## P4. Panel de proveedor (superadmin)

- [x] P4.1 Rutas `/superadmin/tenants` (lista con contadores), `POST` alta con admin inicial, `GET/PATCH /:id` (plan, `trialUntil`, `featureOverrides` validando `requires`, `maxCenters`, `active`) con auditoría; `GET/PATCH /superadmin/plan-requests`
- [x] P4.2 Web `/superadmin/empresas`: cabecera con KPIs (empresas por plan, pruebas que vencen ≤7 días, peticiones abiertas, candidatas a Pro, centros), tabla con filtros (plan · prueba vence ≤7 días · peticiones abiertas · candidatas a Pro · sin actividad), badge de peticiones en el menú
- [x] P4.2b Indicador **"Candidata a Pro"**: columnas citas/mes y no-shows/mes por empresa; marca cuando una Esencial supera umbrales (configurables en código, p. ej. ≥5 no-shows o ≥80 citas/mes); "sin actividad" aproximado por última cita creada (no hay `lastLoginAt` todavía)
- [x] P4.3 Ficha de empresa: cambio de plan y prueba, overrides, límite de centros, activar/suspender, auditoría, **"Entrar como esta empresa"**
- [x] P4.4 Formulario de alta de empresa (datos, slug, zona horaria, admin inicial con contraseña temporal)
- [x] P4.5 Bandeja de peticiones de upgrade (abiertas/cerradas, nota, cerrar)
- [x] P4.6 Conmutador **"Ver como Pro"** (solo SUPERADMIN, D9): cabecera `x-preview-plan` respetada por `requireFeature` y `/tenants/me/plan`; banda visible "Vista previa Pro" en la app; no persiste ni cambia el plan

## P5. Pruebas con vencimiento

- [ ] P5.1 Cron diario 07:30: avisos a 7 y 1 días (Admin + proveedor) y auditoría del vencimiento
- [ ] P5.2 Tarjeta "Tu plan" y panel muestran cuenta atrás de la prueba

## P6. Verificación y documentación

- [ ] P6.1 Typecheck API + web; tests en verde
- [ ] P6.2 E2E: empresa Esencial → menú con candados, 403 en API, portal sin citas, `notify` no registra, botones manuales siguen; cambiar a Pro desde el panel → todo se abre sin recargar datos; prueba vencida → vuelve a Esencial
- [ ] P6.3 `docs/planes.md`: qué incluye cada plan, cómo dar de alta una clínica, asignar plan/prueba, atender peticiones, facturar por centros

## Fase posterior (anotado)

- [ ] Analítica de uso por clínica para el proveedor (citas/mes, mensajes, usuarios activos, último acceso, fallos)
- [ ] Autoservicio con Stripe (cambio de plan y centros con cobro automático)
