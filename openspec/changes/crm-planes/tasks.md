Rama: `feat/crm-planes` desde `main`, PRs pequeños y frecuentes. Cada fase es desplegable sola: con todas las empresas en Pro por defecto, nada cambia en producción hasta asignar planes.

## P1. Modelo y núcleo

- [ ] P1.1 Migración: `enum PlanTier`, `Tenant.plan @default(PRO)`, `trialUntil`, `featureOverrides` (Json), `maxCenters`; tabla `PlanRequest`
- [ ] P1.2 `lib/plan.ts`: catálogo `FEATURES` (clave, plan mínimo, etiqueta, `requires`), `effectivePlan`, `features`, `hasFeature` (puros)
- [ ] P1.3 Tests del núcleo: plan × prueba (activa/vencida) × overrides (add/remove) × dependencias
- [ ] P1.4 `requireFeature(key)` en `lib/authorization.ts` con cache por tenant (60 s) y `403 FEATURE_NOT_IN_PLAN`
- [ ] P1.5 `GET /tenants/me` devuelve `plan`, `effectivePlan`, `trialUntil`, `features[]`, `centersCount`, `maxCenters`
- [ ] P1.6 Seed: contraseña del superadmin desde `SUPERADMIN_PASSWORD` (+ `.env.example`); segunda empresa demo "Clínica Esencial" en plan Esencial

## P2. Guardias en la API y crons

- [ ] P2.1 Aplicar `requireFeature` por módulo: campañas, segmentos, plantillas (`campaigns`); workflow (`workflow`); analítica pro (`analytics_pro`); captación (`captacion`); deliveries y `/customers/:id/deliveries` (`messaging`); no-shows y recovery (`recovery`); api-keys (`api_public`); channels y campos Meta del PATCH config (`channels`)
- [ ] P2.2 Rutas públicas: `/public/v1/*` y `/link/:token/confirm|reschedule` → `public_booking`; `/portal/appointments` → `portal_full` (resolviendo el tenant del token/clave)
- [ ] P2.3 `notify` devuelve `null` sin `messaging`; `createConfirmLink`/`createBookingLink` siguen disponibles para los botones manuales
- [ ] P2.4 Crons: `runWorkflowJob` y `runDueCampaigns` filtran por función
- [ ] P2.5 `POST /centers` → `409 MAX_CENTERS_REACHED` si `maxCenters` alcanzado
- [ ] P2.6 Test de cobertura: toda ruta de módulo Pro tiene guardia (lista explícita) y toda clave usada existe en `FEATURES`
- [ ] P2.7 `POST /tenants/me/plan-request` (ADMIN): crea `PlanRequest` y envía email al proveedor

## P3. Frontend de la clínica

- [ ] P3.1 `useFeatures()` + `features` en el tipo de `/tenants/me`
- [ ] P3.2 Menú: ítems con `feature`; sin ella, icono de candado y navegación a la página bloqueada
- [ ] P3.3 Componente `LockedModule` (título, beneficios, dato propio si existe, botón "Quiero pasar a Pro" → petición + confirmación)
- [ ] P3.4 Envolver cada módulo Pro: Campañas, Workflow, Analítica (parte pro), Captación, Recuperar (pestaña), Comunicaciones (pestaña ficha + Configuración), Canales, API; Reservas/ficha ocultan acciones Pro con tooltip "Disponible en Pro"
- [ ] P3.5 Configuración → tarjeta **"Tu plan"**: plan, prueba, centros/límite, incluye/no incluye, botón de petición, historial (auditoría)
- [ ] P3.6 Portal: sin `portal_full` se ocultan citas y renovación
- [ ] P3.7 Manejo global del `403 FEATURE_NOT_IN_PLAN` en `apiFetch` (mensaje claro, no "Error 403")

## P4. Panel de proveedor (superadmin)

- [ ] P4.1 Rutas `/superadmin/tenants` (lista con contadores), `POST` alta con admin inicial, `GET/PATCH /:id` (plan, `trialUntil`, `featureOverrides` validando `requires`, `maxCenters`, `active`) con auditoría; `GET/PATCH /superadmin/plan-requests`
- [ ] P4.2 Web `/superadmin/empresas`: tabla con filtros (plan · prueba vence ≤7 días · peticiones abiertas · inactivas), badge de peticiones en el menú
- [ ] P4.3 Ficha de empresa: cambio de plan y prueba, overrides, límite de centros, activar/suspender, auditoría, **"Entrar como esta empresa"**
- [ ] P4.4 Formulario de alta de empresa (datos, slug, zona horaria, admin inicial con contraseña temporal)
- [ ] P4.5 Bandeja de peticiones de upgrade (abiertas/cerradas, nota, cerrar)

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
