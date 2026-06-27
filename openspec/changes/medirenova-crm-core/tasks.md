## 1. Monorepo y Setup Inicial

- [x] 1.1 Inicializar monorepo con pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`, `packages/pdf-templates`)
- [x] 1.2 Configurar TypeScript base (`tsconfig.base.json`) compartido entre workspaces
- [x] 1.3 Configurar ESLint y Prettier en el monorepo
- [x] 1.4 Provisionar base de datos PostgreSQL en Neon (entornos: development, staging, production)
- [x] 1.5 Inicializar proyecto Fastify en `apps/api` con estructura de carpetas (routes, plugins, services, repositories)
- [x] 1.6 Inicializar proyecto Next.js 14 en `apps/web` con App Router y Tailwind CSS
- [x] 1.7 Instalar y configurar shadcn/ui en `apps/web`
- [x] 1.8 Configurar variables de entorno (`.env.example`) para api y web

## 2. Base de Datos y ORM

- [x] 2.1 Inicializar Prisma en `apps/api` y configurar `DATABASE_URL`
- [x] 2.2 Crear schema Prisma completo: Tenant, TenantConfig, Center, Room, RoomSchedule, Product, ProductRenewalRule
- [x] 2.3 Crear schema Prisma: FormTemplate, Customer, Appointment, Revision, RevisionAttachment
- [x] 2.4 Crear schema Prisma: WorkflowRule, WorkflowExecution, UserSession, ApiKey, AuditLog
- [x] 2.5 Añadir `tenant_id` en todas las tablas de datos y crear índices compuestos con `tenant_id`
- [x] 2.6 Crear índice único condicional en `appointments(room_id, scheduled_at)` excluyendo CANCELLED/NO_SHOW
- [x] 2.7 Ejecutar migración inicial con `prisma migrate dev`
- [x] 2.8 Activar Row Level Security en PostgreSQL para todas las tablas con datos de tenant
- [x] 2.9 Crear seed inicial: superadmin + tenant de demo con datos de ejemplo

## 3. Autenticación y Autorización

- [x] 3.1 Implementar generación y verificación de JWT con RS256 (access 15min + refresh 7d)
- [x] 3.2 Implementar endpoint `POST /auth/login` con validación bcrypt
- [x] 3.3 Implementar endpoint `POST /auth/refresh` con rotación de refresh token
- [x] 3.4 Implementar endpoint `POST /auth/logout` (invalidar refresh token en BD)
- [x] 3.5 Crear plugin Fastify de autenticación: extrae `tenant_id` y `role` del JWT, inyecta en `request.ctx`
- [x] 3.6 Crear Prisma query extension que añade automáticamente `where: { tenant_id: ctx.tenantId }` en todas las queries
- [x] 3.7 Implementar decorador/middleware de autorización por rol para cada endpoint
- [x] 3.8 Implementar hashing y verificación de API Keys (SHA-256, prefijo `sk_live_`)
- [x] 3.9 Implementar registro de auditoría en `audit_logs` para operaciones sensibles
- [ ] 3.10 Añadir pantalla de login en Next.js con manejo de JWT en httpOnly cookies

## 4. Multitenancy y Tenants

- [x] 4.1 Implementar endpoints CRUD de tenants (`/admin/tenants`) accesibles solo para superadmin
- [ ] 4.2 Implementar resolución de tenant por subdominio o slug en el middleware de Fastify
- [x] 4.3 Implementar endpoints de configuración de tenant (`PATCH /tenants/me/config`)
- [ ] 4.4 Implementar endpoints de branding (`PATCH /tenants/me/branding`)
- [x] 4.5 Implementar endpoints CRUD de API Keys (`/tenants/me/api-keys`)
- [ ] 4.6 Implementar carga dinámica de branding en el frontend (colores CSS variables + logo)

## 5. Centros y Salas

- [x] 5.1 Implementar endpoints CRUD de centros (`/centers`) con validación de tenant_id
- [x] 5.2 Implementar validación de desactivación de centro con reservas futuras
- [x] 5.3 Implementar endpoints CRUD de salas (`/rooms`, `/centers/{id}/rooms`)
- [ ] 5.4 Implementar endpoints de horarios semanales de sala (`PUT /rooms/{id}/schedule`)
- [ ] 5.5 Implementar endpoints de festivos de centro (`PUT /centers/{id}/holidays`)
- [x] 5.6 Implementar UI de gestión de centros en Next.js (listado, creación, edición)
- [x] 5.7 Implementar UI de gestión de salas y horarios (calendario semanal visual)

## 6. Productos y Reglas de Renovación

- [x] 6.1 Implementar endpoints CRUD de productos (`/products`) con validación de reglas por edad
- [x] 6.2 Implementar validación de cobertura completa de rangos de edad en `renewal_rules`
- [x] 6.3 Implementar función de cálculo de `expiry_date` dado `birth_date` + `revision_date` + `renewal_rules`
- [ ] 6.4 Implementar endpoint de upload de plantilla PDF por producto
- [x] 6.5 Implementar UI de gestión de productos con editor de reglas de renovación por edad
- [x] 6.6 Cargar reglas DGT por defecto como seed para productos de tipo `CARNET_CONDUCIR`

## 7. Form Builder

- [x] 7.1 Implementar endpoints de gestión de FormTemplates (`GET/POST /products/{id}/forms`, `POST /forms/{id}/activate`)
- [ ] 7.2 Implementar validación del JSON Schema de formulario en el backend (tipos de campo, required, etc.)
- [ ] 7.3 Implementar UI del form builder con `@dnd-kit/core` para drag & drop de campos
- [ ] 7.4 Implementar panel de propiedades de campo (configurar label, required, opciones, validaciones)
- [ ] 7.5 Implementar lógica de versionado: nueva versión en draft, activar desactiva anterior
- [ ] 7.6 Implementar preview del formulario en el builder
- [ ] 7.7 Implementar plantillas base de formulario (reconocimiento conducir, licencia armas, DNI)

## 8. Clientes

- [x] 8.1 Implementar encriptado AES-256-GCM del DNI a nivel de aplicación (antes de escribir en BD)
- [x] 8.2 Implementar validación de letra de control del DNI español
- [x] 8.3 Implementar endpoints CRUD de clientes con registro de consentimiento GDPR
- [x] 8.4 Implementar búsqueda paginada de clientes (nombre, apellidos, teléfono, email; DNI exacto)
- [x] 8.5 Implementar soft delete con anonimización de PII (`DELETE /customers/{id}`)
- [x] 8.6 Implementar `GET /customers/{id}/revisions` con historial de revisiones
- [x] 8.7 Implementar UI de búsqueda/listado de clientes con filtros
- [x] 8.8 Implementar UI de ficha de cliente con historial y datos personales

## 9. Reservas y Disponibilidad

- [x] 9.1 Implementar motor de disponibilidad dinámica: `GET /centers/{id}/availability?product_id&date`
- [x] 9.2 Implementar protección contra double-booking con manejo de error `P2002` de Prisma
- [x] 9.3 Implementar endpoints de reservas: `POST /appointments`, `GET /appointments`, `GET /appointments/{id}`
- [x] 9.4 Implementar transiciones de estado: cancelar, reprogramar, marcar no-show
- [x] 9.5 Implementar generación de archivo `.ics` al confirmar reserva (RFC 5545)
- [x] 9.6 Implementar UI de creación de reserva desde backoffice (selector de cliente, producto, centro, slot)
- [x] 9.7 Implementar UI de agenda/calendario de reservas del día (vista por sala)
- [x] 9.8 Implementar UI de listado de reservas con filtros (fecha, estado, centro, médico)

## 10. Magic Link

- [x] 10.1 Implementar generación de JWT magic link con claims `{cid, pid, tid, type: 'magic_link', exp: 24h}`
- [x] 10.2 Implementar `GET /magic/{token}` — validar token, devolver contexto (producto, centros, slots 7d)
- [x] 10.3 Implementar `POST /magic/{token}/confirm` — crear reserva con source MAGIC_LINK
- [x] 10.4 Implementar `POST /magic/{token}/reschedule` — cancelar reserva anterior, crear nueva
- [ ] 10.5 Implementar lógica de expansión de búsqueda a 30 días si no hay slots en 7 días
- [x] 10.6 Implementar página pública de magic link en Next.js (sin layout de app, sin login requerido)
- [x] 10.7 Implementar UI de selección de centro, slot y confirmación en la página de magic link

## 11. Revisiones Médicas

- [x] 11.1 Implementar `POST /revisions` — crear revisión desde appointment, cargar form_template activo
- [x] 11.2 Implementar `PATCH /revisions/{id}` — guardar draft de form_data parcial
- [x] 11.3 Implementar upload de fotos/PDFs (`POST /revisions/{id}/attachments`) vía interfaz `Storage` (local en dev, R2 en Paso B)
- [x] 11.4 Implementar `POST /revisions/{id}/complete` — validar campos requeridos, determinar outcome, calcular expiry_date
- [x] 11.5 Configurar Puppeteer en el backend (browser headless compartido y reutilizado)
- [x] 11.6 Implementar renderizado de plantilla Handlebars + generación PDF con Puppeteer
- [ ] 11.7 Subir PDF a Cloudflare R2 y devolver URL firmada en respuesta (Paso B; ahora storage local vía interfaz `Storage`)
- [x] 11.8 Implementar `GET /revisions/{id}/pdf` — genera si falta y sirve el certificado (URL firmada R2 1h pendiente de Paso B)
- [x] 11.9 Implementar UI de revisión médica: renderizado dinámico del formulario JSON Schema
- [x] 11.10 Implementar componente de firma digital en el formulario (canvas)
- [x] 11.11 Implementar UI de adjunto de fotos con preview

## 12. Workflow Comercial

- [x] 12.1 Implementar endpoints CRUD de reglas de workflow (`/workflow-rules`)
- [x] 12.2 Implementar job cron diario con `node-cron` que detecta caducidades en horizonte de reglas activas
- [x] 12.3 Implementar lógica de exclusión: no enviar si cliente ya tiene reserva confirmada futura
- [x] 12.4 Implementar generación de magic link en el cron y registro en `workflow_executions`
- [x] 12.5 Implementar envío de WhatsApp vía Meta Cloud API con plantilla aprobada
- [x] 12.6 Implementar lógica de reintentos basada en `next_attempt_at` y `attempt_count`
- [x] 12.7 Implementar detención automática de workflow al crear reserva confirmada
- [x] 12.8 Implementar UI de configuración de reglas de workflow para el admin

## 13. Dashboard

- [x] 13.1 Implementar `GET /dashboard/summary` — KPIs: reservas hoy, semana, expedientes abiertos, tasa conversión
- [x] 13.2 Implementar `GET /dashboard/expirations` — caducidades a 30/60/90 días con flag de reserva existente
- [x] 13.3 Implementar `GET /dashboard/charts/appointments-by-month` — últimos 12 meses
- [x] 13.4 Implementar `GET /dashboard/charts/customers-by-province` — conteo por provincia
- [x] 13.5 Implementar UI del dashboard con componentes shadcn/ui y Recharts para gráficos
- [x] 13.6 Implementar panel de caducidades próximas con links directos a ficha de cliente

## 14. API Pública

- [x] 14.1 Implementar plugin Fastify de autenticación por API Key con lookup en BD
- [ ] 14.2 Implementar rate limiting por API Key (1.000 req/hora) con Redis o in-memory para MVP
- [ ] 14.3 Implementar `GET /public/v1/products` y `GET /public/v1/centers`
- [ ] 14.4 Implementar `GET /public/v1/centers/{id}/availability`
- [ ] 14.5 Implementar `POST /public/v1/customers` con las mismas validaciones del backoffice
- [ ] 14.6 Implementar `POST /public/v1/appointments` con protección double-booking
- [ ] 14.7 Implementar formato envelope en todas las respuestas de la API pública
- [ ] 14.8 Generar documentación OpenAPI/Swagger para la API pública

## 15. Deploy y Producción

- [x] 15.1 Configurar pipeline CI/CD en GitHub Actions (lint + typecheck + build en cada PR)
- [x] 15.2 Configurar deploy automático del backend en Railway (branch main)
- [x] 15.3 Configurar deploy automático del frontend en Vercel (branch main)
- [ ] 15.4 Configurar Cloudflare R2 bucket con política de acceso privado y URLs firmadas
- [ ] 15.5 Activar RLS policies en PostgreSQL de producción
- [ ] 15.6 Configurar Meta Cloud API: cuenta Business, plantillas de WhatsApp (requiere aprobación 48-72h)
- [ ] 15.7 Configurar dominio y SSL para api y frontend
- [ ] 15.8 Ejecutar smoke tests en staging antes de primera puesta en producción
- [ ] 15.9 Configurar Chromium para Puppeteer en Railway (nixpacks/buildpack) para la generación de PDF

## 16. Testing (red de seguridad)

- [x] 16.1 Configurar Vitest en `apps/api` (`pnpm --filter api test`)
- [x] 16.2 Tests unitarios de aislamiento multitenant (`withTenantFilter`, tarea 3.6)
- [x] 16.3 Tests unitarios de cifrado/GDPR (`crypto`: DNI AES-256-GCM, API keys)
- [x] 16.4 Integrar `test` en el pipeline de CI (GitHub Actions)
- [ ] 16.5 Tests de validación de letra de control del DNI español (extraer `validateSpanishDni` a util testeable)
- [x] 16.6 Tests del cálculo de `expiry_date` por reglas de edad (tarea 6.3)
- [ ] 16.7 Tests de integración de protección double-booking (error `P2002`)
- [ ] 16.8 Tests E2E del flujo magic-link → reserva
- [ ] 16.9 Configurar testing en `apps/web` (Vitest + Testing Library / Playwright)
