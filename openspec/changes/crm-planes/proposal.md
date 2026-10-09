## Why

Hoy MediRenova es **todo o nada**: cada clínica recibe la gestión operativa (agenda, visitas, reconocimientos, certificados) y la capa CRM (avisos, recuperación de no-shows, campañas, captación, analítica avanzada, portal) en el mismo paquete. Eso deja fuera a la clínica pequeña que solo quiere "ordenar su día" y no está dispuesta a pagar por comunicación y marketing, y a la vez diluye el valor del CRM, que es la parte que cuesta dinero de verdad (mensajería) y la que diferencia el producto.

Queremos **dos líneas de comercialización** sobre **un único producto**: un plan **Esencial** (gestión de la clínica) y un plan **Pro** (Esencial + CRM). Y, para poder operarlo, un **panel de proveedor** desde el que MediRenova dé de alta clínicas, asigne planes, gestione periodos de prueba y siga las licencias; hoy el superadmin solo puede "actuar como" una empresa, no gestionarlas.

## What Changes

- **Plan por empresa** (`Tenant.plan`: `ESSENTIAL` | `PRO`), con **periodo de prueba** (`trialUntil`), **excepciones por función** (`featureOverrides`) y **límite de centros** opcional (`maxCenters`). Las clínicas existentes quedan en **Pro**: el despliegue no cambia nada hasta que se cambie un plan.
- **Catálogo de funciones** único (`lib/plan.ts`): cada función del producto con su plan mínimo. Las decisiones de frontera: portal **partido** (certificados en Esencial; citas y renovación en Pro), **recordatorios/avisos automáticos en Pro**, **analítica partida** (KPIs operativos en Esencial; embudo, fugas, drill-down y captación en Pro), **multi-centro como eje de precio** (cualquier plan; se factura por centro).
- **Guardia en la API** (`requireFeature`) en los módulos Pro y en los crons; **menú** filtrado y **página "candado"** en cada módulo bloqueado con el beneficio y un botón "Quiero pasar a Pro".
- **Tarjeta "Tu plan"** en Configuración (solo lectura para el Admin de la clínica) con plan, centros, prueba, qué incluye y la petición de cambio.
- **Panel de proveedor** (superadmin): lista de empresas con plan/centros/prueba/estado, ficha para cambiar plan y prueba, alta de empresa con admin inicial, peticiones de upgrade, "Entrar como esta empresa" (reutiliza la impersonación) y auditoría de cambios.
- **Vencimiento automático** de pruebas (cron) con aviso previo al Admin y al proveedor; **downgrade sin pérdida de datos** (se bloquea, no se borra).

**No-goals:**
- Cobro/facturación dentro del producto (Stripe): el panel registra plan y centros; el cobro se hace fuera en esta iteración.
- Plan distinto por centro dentro de una misma empresa.
- Cobro por usuario.
- Analítica de uso por clínica para el proveedor (bloque 4 del panel): se anota como fase posterior.

## Capabilities

### New Capabilities

- `crm-planes`: Planes Esencial/Pro por empresa con catálogo de funciones, guardias en API y UI, pruebas con vencimiento, excepciones por función, límite de centros, tarjeta "Tu plan" con petición de upgrade y panel de proveedor para gestionar empresas y licencias.

### Modified Capabilities

- Todos los módulos Pro (`messaging`, `recovery`, `campaigns`, `workflow`, `analytics_pro`, `captacion`, `portal_full`, `public_booking`, `api_public`, `channels`): pasan a estar condicionados por el plan efectivo de la empresa.
- `crm-portal-paciente`: el portal se divide en certificados (Esencial) y citas/renovación (Pro).
- `crm-mensajeria`: `notify` no genera avisos para empresas sin `messaging`; los botones manuales (WhatsApp web / email) siguen disponibles en Esencial.
- `centers`: alta de centro limitada por `maxCenters` cuando está definido.

## Impact

- **Modelo → migración aditiva**: `Tenant.plan` (default `PRO`), `trialUntil`, `featureOverrides`, `maxCenters`; `PlanRequest` (peticiones de upgrade). Los cambios de plan se auditan en `AuditLog`.
- **Backend**: `lib/plan.ts` (catálogo + `effectivePlan` + `hasFeature`, puros), `requireFeature`, guardias por módulo, filtro en crons, `GET /tenants/me` con plan y funciones, `POST /tenants/me/plan-request`, rutas `/superadmin/*`, cron de vencimiento.
- **Frontend**: `useFeatures()`, menú filtrado, componente `LockedModule`, tarjeta "Tu plan", módulo `/superadmin/empresas` (lista, ficha, alta, peticiones).
- **Producción**: cero cambio funcional al desplegar (todas las empresas en Pro). Las dos líneas se activan al asignar planes desde el panel.
- **Seguridad**: la contraseña del superadmin del seed pasa a leerse de una variable de entorno (está fija en el código).
