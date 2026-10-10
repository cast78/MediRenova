# Design — crm-planes (Esencial / Pro + panel de proveedor)

## Contexto reutilizado (ya existe)

- Roles: `SUPERADMIN` (100, proveedor), `ADMIN` (80), `RECEPTIONIST` (40), `DOCTOR` (30); `requireRole` / `requireAnyRole` en `lib/authorization.ts`.
- Impersonación del superadmin: cabecera `x-act-as-tenant` + selector "Empresa (superadmin)" en `app-layout.tsx`.
- Alta de empresa por API (`POST /tenants`, superadmin), `GET /tenants/me`, `TenantConfig`, `AuditLog`.
- Menú por secciones y roles en `app-layout.tsx` (Operación · Gestión · Comercial · Administración).
- Módulos: Reservas, Visitas, Consulta, Revisiones, Clientes, Analítica, Captación, Campañas, Workflow, Centros, Productos, Formularios, Médicos, Equipo, Configuración, Portal (`/mi-area`), reserva pública (`/booking`, `/public/v1`), Comunicaciones (`crm-mensajeria`).

## Matriz de planes (decisiones confirmadas)

| Función (clave) | Esencial | Pro | Módulo / rutas afectadas |
|---|---|---|---|
| Agenda, visitas, consulta, revisiones, PDF, clientes, RGPD | ✅ | ✅ | sin guardia |
| Botones manuales "Pedir confirmación" / "Invitar" (WhatsApp web, email, copiar) | ✅ | ✅ | `confirmation-link`, `/link/generate` |
| `portal_certificates` — Mi área: acceso + descarga de certificados | ✅ | ✅ | `/portal/request-access`, `/portal/revisions*` |
| `portal_full` — Mi área: citas, renovación desde el portal | ❌ | ✅ | `/portal/appointments` (+ Fase 2 del portal) |
| `analytics_basic` — KPIs operativos (dashboard, ocupación, citas del mes) | ✅ | ✅ | `/dashboard`, utilización |
| `analytics_pro` — embudo, fugas, drill-down, histórico | ❌ | ✅ | `/analytics/*` (excepto resumen básico) |
| `captacion` — efectividad de campañas | ❌ | ✅ | `/captacion*` |
| `messaging` — avisos automáticos + Comunicaciones + plantillas | ❌ | ✅ | `notify`, `/deliveries*`, `/customers/:id/deliveries` |
| `recovery` — pestaña Recuperar no-shows | ❌ | ✅ | `/appointments/no-shows`, `/appointments/:id/recovery` |
| `campaigns` — campañas y segmentos | ❌ | ✅ | `/campaigns*`, `/segments*`, `/message-templates*` |
| `workflow` — renovación automática | ❌ | ✅ | `/workflow*`, cron `runWorkflowJob` |
| `public_booking` — reserva pública y auto-reserva por enlace mágico | ❌ | ✅ | `/public/v1/*`, `/link/:token/confirm|reschedule` |
| `api_public` — claves de API e integraciones | ❌ | ✅ | `/tenants/me/api-keys*` |
| `channels` — configuración de WhatsApp/email/SMS | ❌ | ✅ | `/tenants/me/channels*`, PATCH config (campos Meta) |
| Multi-centro | ✅ (por centro) | ✅ (por centro) | `POST /centers` respeta `maxCenters` |

Nota sobre dependencias: `recovery` muestra la bandeja aunque no haya `messaging` (la invitación sería manual); en Pro van las dos. `public_booking` incluye el enlace de auto-reserva que usan `workflow` y `recovery`; como todos son Pro, no hay combinación incoherente salvo por `featureOverrides`, que el panel valida (activar `workflow` exige `public_booking`).

## Modelo de datos

```prisma
enum PlanTier { ESSENTIAL PRO }

model Tenant {
  plan             PlanTier  @default(PRO)      // existentes = Pro: el despliegue no cambia nada
  trialUntil       DateTime? @map("trial_until") // prueba Pro activa hasta esta fecha
  featureOverrides Json?     @map("feature_overrides") // { "add": ["portal_full"], "remove": [] }
  maxCenters       Int?      @map("max_centers") // null = sin límite
}

model PlanRequest {            // "Quiero pasar a Pro" desde la clínica
  id, tenantId, requestedPlan PlanTier, byUserId, note?, status (OPEN|CLOSED), createdAt, closedAt?
}
```

Los cambios de plan se registran en `AuditLog` (`resourceType: "tenant_plan"`, meta `{ from, to, trialUntil }`), por lo que no hace falta tabla de historial.

## Núcleo puro — `lib/plan.ts`

```ts
export const FEATURES = {
  portal_certificates: { min: "ESSENTIAL", label: "Portal: certificados" },
  portal_full:         { min: "PRO", label: "Portal: citas y renovación", requires: ["portal_certificates"] },
  analytics_basic:     { min: "ESSENTIAL", ... },
  analytics_pro:       { min: "PRO", ... },
  captacion:           { min: "PRO", requires: ["campaigns"] },
  messaging:           { min: "PRO" },
  recovery:            { min: "PRO" },
  campaigns:           { min: "PRO" },
  workflow:            { min: "PRO", requires: ["public_booking"] },
  public_booking:      { min: "PRO" },
  api_public:          { min: "PRO" },
  channels:            { min: "PRO", requires: ["messaging"] },
} as const;

effectivePlan(t, now)  // trialUntil > now ? "PRO" : t.plan
features(t, now)       // todas con min <= effectivePlan, + overrides.add, − overrides.remove, cerrando `requires`
hasFeature(t, key, now)
```

Puro y testeado (matriz plan × prueba × overrides × dependencias).

## Backend

- **`requireFeature(key)`** (`lib/authorization.ts`): preHandler que carga el tenant del contexto (cache 60 s por tenant) y responde `403 { code: "FEATURE_NOT_IN_PLAN", feature, plan }`. El `SUPERADMIN` no está exento: ve lo mismo que la empresa en la que actúa (para que la demo sea fiel).
- **Aplicación por módulo**: en el registro de rutas de cada módulo Pro (campañas, segmentos, plantillas, workflow, analítica pro, captación, deliveries, no-shows/recovery, api-keys, channels, portal full, public booking). Las rutas públicas sin usuario (`/public/v1`, `/link/:token/*`, `/portal/*`) resuelven el tenant del token/clave y aplican la misma comprobación.
- **`notify`**: si la empresa no tiene `messaging`, no crea `MessageDelivery` y devuelve `null`. Los enlaces (`createConfirmLink`) se generan igual para que los botones manuales de Esencial sigan dando enlace corto.
- **Crons**: `runWorkflowJob` y `runDueCampaigns` saltan empresas sin la función; `episode-alerts` y `appointment-sweep` son operativos → sin guardia.
- **Centros**: `POST /centers` responde `409 MAX_CENTERS_REACHED` cuando `maxCenters` está definido y se alcanza.
- **`GET /tenants/me`**: añade `plan`, `effectivePlan`, `trialUntil`, `features: string[]`, `centersCount`, `maxCenters`.
- **`POST /tenants/me/plan-request`** (ADMIN): crea `PlanRequest` y avisa al proveedor por email (cliente de email existente).
- **Rutas de proveedor** (`/superadmin/*`, rol `SUPERADMIN`, sin impersonación):
  - `GET /superadmin/tenants` — lista con plan, prueba, nº centros, nº usuarios, último acceso, peticiones abiertas.
  - `POST /superadmin/tenants` — alta: empresa + config + admin inicial (contraseña temporal enviada por email o mostrada una vez).
  - `GET/PATCH /superadmin/tenants/:id` — plan, `trialUntil`, `featureOverrides` (validando `requires`), `maxCenters`, `active`; cada PATCH audita.
  - `GET /superadmin/plan-requests`, `PATCH /superadmin/plan-requests/:id` (cerrar).
- **Cron de pruebas** (diario 07:30): empresas con `trialUntil` a 7 y a 1 días → email al Admin y al proveedor; al vencer, `effectivePlan` cae solo (no hay que escribir nada) y se audita el vencimiento.
- **Seed**: contraseña del superadmin desde `SUPERADMIN_PASSWORD` (env), con valor de desarrollo si falta.

## Frontend

- `useFeatures()` (de `/tenants/me`, cacheado): `has("campaigns")`.
- **Menú**: los ítems llevan `feature?`; sin la función, el ítem se muestra con un **candado** (no se oculta) y lleva a la página del módulo en modo bloqueado.
- **`LockedModule`**: componente común con título, 3 beneficios concretos del módulo (con datos propios cuando existan: "este mes 14 no-shows"), captura/ilustración, y botón **"Quiero pasar a Pro"** → `plan-request` → confirmación "Te contactaremos". Cada módulo Pro envuelve su página: `if (!has("campaigns")) return <LockedModule feature="campaigns" />`.
- **Configuración → "Tu plan"** (primera tarjeta de la pestaña Empresa): plan, "Prueba Pro hasta {fecha}" si aplica, centros contratados / límite, lista de lo que incluye y lo que no, botón de petición, historial de cambios.
- **Panel de proveedor** `/superadmin/empresas` (solo `SUPERADMIN`, fuera del selector de empresa): tabla con filtros (plan, prueba vence en 7 días, peticiones abiertas, inactivas) y acciones; ficha con cambio de plan/prueba/overrides/centros, auditoría y **"Entrar como esta empresa"** (activa la impersonación existente y navega al dashboard). Formulario de alta de empresa.
- **Portal del paciente**: sin `portal_full` se oculta la sección de citas y los enlaces de renovación.

## Experiencia del superadmin (P4b, mockup aprobado)

- **Dos modos** en la misma app: *proveedor* (sin empresa seleccionada: menú corto Empresas/Peticiones, aterrizaje en `/superadmin/empresas`) y *empresa* (actuando como una clínica: su menú, con una **barra superior** fija que dice qué empresa es, su plan y centros, con "Ver como Pro" y "Volver al panel"). El selector ámbar del menú desaparece: entrar y salir de una empresa es un gesto explícito.
- **Lista como centro de mando**: KPIs que filtran, columna "Atención" y orden por atención necesaria; panel lateral con resumen, gráfica de 6 meses y acciones rápidas; la ficha completa queda a un clic.
- **Cambio de plan con confirmación**: diálogo que resume qué gana/pierde la clínica, la facturación resultante y cierra la petición abierta; motivo obligatorio para la auditoría.
- **Ficha por pestañas** con la licencia reducida a lo esencial y las excepciones plegadas.
- **Antojo del Pro para la clínica (P4c)**: NO se abre la vista previa a la clínica (un modo solo-lectura filtraría datos de módulos Pro, daría una experiencia a medias y computaría analítica gratis). En su lugar: (1) **prueba Pro en autoservicio** de 14 días, una vez por empresa, auditada y notificada al proveedor; (2) **cebos con datos propios** en las páginas bloqueadas: una cifra segura por módulo ("este mes 14 no-shows"), nunca el contenido del módulo.

## Demo

Clínica Demo queda en **Pro**. Se añade una segunda empresa de demo **"Clínica Esencial"** (seed) para enseñar el plan básico y el candado; y desde el panel se cambia el plan en vivo.

## Decisiones (confirmadas)

- **D1** Plan por **empresa**, no por centro.
- **D2** Centros como **eje de precio**; `maxCenters` opcional; facturación fuera del producto.
- **D3** Clínicas existentes → **Pro** por defecto (despliegue neutro).
- **D4** Módulos bloqueados se **muestran con candado**, no se ocultan.
- **D5** Portal partido; recordatorios en Pro; analítica partida.
- **D6** Superadmin **no exento** de la guardia al actuar como empresa.
- **D7** Pruebas Pro con vencimiento automático y avisos a 7 y 1 días.
- **D8** Sin cobro por usuario; sin Stripe en esta iteración.
- **D9** "Entrar como esta empresa" muestra la empresa **tal cual** (con sus candados). Solo el superadmin dispone de un conmutador **"Ver como Pro"** (vista previa, no cambia el plan ni se persiste; se señala con una banda visible) para enseñar en vivo lo que tendría la clínica. Implementación: cabecera `x-preview-plan: PRO` que `requireFeature` y `/tenants/me/plan` respetan únicamente cuando el usuario es SUPERADMIN.

## Riesgos / notas

- **Coherencia del Esencial**: cada función nueva debe declarar su plan en el catálogo (test que falla si una ruta Pro no tiene guardia o una clave no está en `FEATURES`).
- **Rutas públicas**: la guardia depende de resolver bien el tenant (token/clave); probar `public_booking` y `portal_full` con y sin plan.
- **Overrides incoherentes**: validar `requires` en el PATCH del panel.
- **Calibrado comercial**: las fronteras se cambian en el catálogo sin tocar módulos; si una función cambia de plan, basta editar `FEATURES`.
- **Contraseña del superadmin** en el seed: moverla a env antes de tener clientes reales (tarea P1.6).
