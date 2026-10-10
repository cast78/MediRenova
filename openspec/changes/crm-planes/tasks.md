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

## P4b. Experiencia del superadmin (mockup "Panel de proveedor — mockup", aprobado)

- [x] P4b.1 **Dos modos**: sin empresa seleccionada el superadmin ve el **modo proveedor** (menú propio y corto: Empresas · Peticiones; marca MediRenova; etiqueta "Modo proveedor") y aterriza en `/superadmin/empresas` tras el login; con empresa seleccionada, **modo empresa** (menú de la clínica)
- [x] P4b.2 **Barra superior del modo empresa** (sustituye al selector ámbar): "Estás viendo {empresa} como superadmin · plan · centros", casilla **Ver como Pro** (barra azul "Vista previa Pro · nada se guarda") y **Volver al panel** (limpia empresa y vista previa)
- [x] P4b.3 Lista: **KPIs clicables** que filtran; columna **Atención** (petición abierta · prueba vence en N días · candidata a Pro · sin actividad · al día) y orden por atención; búsqueda por empresa, slug y email del admin
- [x] P4b.4 **Panel lateral** al pulsar una fila: resumen, motivo de atención, gráfica de citas de 6 meses (API: `monthly`), atajos de prueba 14/30/60 días, "Pasar a Pro…" / "Cambiar a Esencial…", Entrar como, Ver ficha
- [x] P4b.5 **Diálogo de confirmación** de cambio de plan: módulos que se abren o se cierran, facturación resultante (plan × centros), cierre automático de la petición abierta, motivo obligatorio (auditoría). API: `PATCH` acepta `closeOpenRequests`
- [x] P4b.6 **Ficha por pestañas** (Licencia · Actividad · Usuarios · Centros · Auditoría); Licencia reducida a plan + prueba (con atajos y "quitar") + límite, frase "con estos valores tendrá…", excepciones plegadas en "Ajustes avanzados"; tarjeta de petición abierta con acciones
- [x] P4b.7 Estados vacíos con guía y badge de peticiones abiertas en el menú del proveedor

## P4c. "Antojo" del Pro para clínicas Esencial (sin abrir la vista previa a la clínica)

- [x] P4c.1 **Petición de prueba Pro (opción B, con autorización)**: botón "Pedir prueba Pro de 14 días" en las páginas con candado y en "Tu plan"; `POST /tenants/me/trial` (ADMIN) crea una `PlanRequest` de tipo **TRIAL** (nada se activa); el proveedor la **aprueba** desde Peticiones (`PATCH … { status: APPROVED, trialDays }` activa la prueba, audita) o la **rechaza** con motivo que ve la clínica; una prueba aprobada por empresa; `PlanRequest.kind` (UPGRADE|TRIAL) y estados OPEN|APPROVED|REJECTED|CLOSED; la clínica ve el estado "pendiente de aprobación" en candados y "Tu plan"
- [x] P4c.2 **Cebos con datos propios** en `LockedModule`: `GET /tenants/me/plan-teasers` devuelve cifras seguras (no-shows del mes, certificados que caducan en 60 días, citas del mes, pacientes sin consentimiento de canal…) y cada módulo bloqueado muestra la suya: Recuperar → "Este mes has tenido N no-shows"; Workflow → "N certificados caducan en 60 días"; Campañas → "N pacientes con email/WhatsApp consentido"; Analítica → "N citas este mes"; Comunicaciones → "N citas creadas este mes sin aviso automático"
- [x] P4c.3 La vista previa "Ver como Pro" sigue siendo **exclusiva del superadmin** (D9); se documenta por qué (fugas de datos en solo-lectura, experiencia a medias, coste)
- [x] P4c.4 **Centro adicional con autorización**: en Centros, al límite, el botón "Nuevo centro" queda deshabilitado con aviso; en "Tu plan" y en Centros, **"Solicitar un centro más"** crea una petición de tipo **CENTER** (`POST /tenants/me/center-request`); el proveedor la aprueba ("Ampliar límite +1", `extraCenters`) o la rechaza; la API sigue devolviendo `409 MAX_CENTERS_REACHED` al crear por encima del límite

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
