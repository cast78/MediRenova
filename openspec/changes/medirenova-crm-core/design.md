## Context

MediRenova es un CRM SaaS multitenant greenfield para centros médicos que gestionan reconocimientos para renovación de documentos oficiales en España (carnet de conducir, licencia de armas, DNI). No existe código previo. El sistema debe soportar múltiples clínicas independientes (tenants) con aislamiento total de datos, flujos de reserva automatizados y generación de certificados médicos en PDF.

Stack decidido: **Next.js 14** (frontend, Vercel), **Node.js + Fastify** (backend, Railway), **Prisma** (ORM), **PostgreSQL en Neon** (base de datos), **Cloudflare R2** (storage), **Puppeteer** (PDF), **Meta Cloud API** (WhatsApp).

## Goals / Non-Goals

**Goals:**
- Arquitectura monorepo con frontend y backend separados pero coordinados
- Multitenancy por row-level security en PostgreSQL con middleware de inyección automática de `tenant_id`
- Motor de disponibilidad dinámico (sin slots precreados)
- Builder de formularios basado en JSON Schema versionado
- Generación de PDF síncrona con Puppeteer al completar revisión
- Workflow comercial cron-based para alertas de caducidad
- API pública REST autenticada por API Key
- Cumplimiento GDPR: DNI encriptado en reposo, soft delete, consentimiento auditado
- Solo España (sin i18n)

**Non-Goals:**
- Integración bidireccional con Google Calendar (solo generación de .ics)
- Multiidioma
- App móvil nativa
- Facturación / módulo de pagos
- Integración con sistemas de sanidad pública (eSalud, etc.)
- Schemas de BD separados por tenant (se usa row-level)

## Decisions

### D1: Multitenancy — Row-Level Security en una sola BD

**Decisión**: Todas las tablas incluyen `tenant_id UUID NOT NULL`. Un middleware Fastify extrae el `tenant_id` del JWT y lo inyecta automáticamente en todas las queries de Prisma mediante un query extension que añade `.where({ tenant_id })` a toda operación de lectura/escritura.

Como segunda capa de defensa, se activa **PostgreSQL Row Level Security**:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

**Alternativa descartada**: Schemas separados por tenant. Descartado por complejidad de migraciones y overhead operacional para un MVP.

---

### D2: Motor de Disponibilidad — Cálculo Dinámico

**Decisión**: Los slots no se precrean. La disponibilidad se calcula en tiempo real:
1. Obtener `room_schedule` (JSON con horarios por día de semana)
2. Generar slots del día según `duration_minutes` del producto
3. Restar `appointments` existentes con `status IN ('CONFIRMED', 'PENDING')`
4. Restar festivos del centro para esa fecha
5. Devolver slots libres

Protección contra double-booking mediante **índice único condicional**:
```sql
CREATE UNIQUE INDEX uq_appointment_slot
  ON appointments(room_id, scheduled_at)
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');
```

**Alternativa descartada**: Tabla de slots precreados. Descartado por inflexibilidad ante cambios de horario y volumen de datos innecesario.

---

### D3: Form Builder — JSON Schema versionado

**Decisión**: Los formularios se almacenan como JSONB en `form_templates.schema`. El schema define secciones, campos con sus tipos y validaciones, y el mapeo a variables del PDF. Cada versión es inmutable una vez activada. Las revisiones guardan una referencia al `form_template_id` y los datos rellenos en `form_data` (JSONB).

Tipos de campo: `text`, `number`, `photo`, `select`, `checkbox`, `signature`.

El frontend renderiza el formulario dinámicamente interpretando el schema. El drag & drop usa `@dnd-kit/core`.

---

### D4: Generación de PDF — Puppeteer síncrono

**Decisión**: Al completar una revisión (`POST /revisions/{id}/complete`), el backend renderiza la plantilla HTML/Handlebars del producto con los datos del formulario y genera el PDF con Puppeteer en la misma request. El PDF se sube a Cloudflare R2 y se devuelve la URL firmada.

Tiempo estimado: 2–4 segundos. Aceptable para el contexto médico.

**Alternativa descartada**: Cola async (Bull/BullMQ). Descartado para simplificar el MVP. Se puede migrar si el volumen lo requiere.

---

### D5: Workflow Comercial — Cron + tabla de ejecuciones

**Decisión**: Un job cron diario (implementado con `node-cron` en el backend) recorre las revisiones con estado `APTO` y comprueba si la `expiry_date` cae en el horizonte de la regla (90/60/30 días). Si corresponde, genera un magic link, registra una `workflow_execution` y envía el WhatsApp via Meta Cloud API.

Los reintentos se gestionan con `next_attempt_at` y `attempt_count` en `workflow_executions`.

---

### D6: Magic Link — JWT sin sesión

**Decisión**: El magic link contiene un JWT firmado con claims: `{ cid: customer_id, pid: product_id, tid: tenant_id, type: 'magic_link' }` con expiración de 24h. No se almacena el token en BD; la validez se verifica por la firma JWT y la expiración. Si el cliente confirma reserva, el token queda implícitamente consumido (la reserva pasa a CONFIRMED).

Para reprogramar, se puede reutilizar el mismo token mientras no haya caducado.

**Alternativa descartada**: Token opaco en BD con campo `used_at`. Descartado para simplificar — el JWT stateless es suficiente para el caso de uso.

---

### D7: Autenticación — JWT con refresh token

**Decisión**: 
- Access token: JWT, expiración 15 minutos, firmado con RS256
- Refresh token: opaco, almacenado en BD (`user_sessions`), expiración 7 días, rotación en cada uso
- Roles codificados en el access token como claim `role`
- API Keys para la API pública: prefijo `sk_live_` + 32 bytes aleatorios, hash SHA-256 almacenado en BD

---

### D8: Estructura del Monorepo

```
medirenova/
├── apps/
│   ├── web/          # Next.js 14 (App Router)
│   └── api/          # Fastify + Prisma
├── packages/
│   ├── shared/       # Tipos TypeScript compartidos, validaciones Zod
│   └── pdf-templates/ # Plantillas HTML/Handlebars para PDFs
└── package.json      # pnpm workspaces
```

---

### D9: GDPR

- DNI encriptado en reposo usando AES-256-GCM a nivel de aplicación (antes de escribir en BD)
- `gdpr_consent_at` y `gdpr_consent_ip` registrados en el momento de creación del cliente
- Soft delete en customers: campo `deleted_at`, datos PII puestos a null
- Logs de auditoría en tabla `audit_logs` para operaciones sensibles (crear/modificar/borrar clientes y revisiones)

## Risks / Trade-offs

| Riesgo | Mitigación |
|--------|------------|
| Double-booking bajo carga concurrente | Índice único condicional en PostgreSQL + manejo de error `P2002` de Prisma |
| Fuga de datos entre tenants si falla el middleware | RLS en PostgreSQL como segunda capa de defensa |
| Puppeteer consume mucha memoria (~500MB por instancia Chrome) | Pool de máximo 2 instancias en Railway; escalar el plan si el volumen crece |
| Meta Cloud API requiere aprobación de plantillas (48-72h) | Usar Twilio en desarrollo; tener plantillas listas con antelación |
| JWT magic link no revocable antes de expirar | Ventana de 24h aceptable para el caso de uso; se puede añadir blocklist si surge el requisito |
| Neon (PostgreSQL serverless) tiene cold starts | Usar connection pooling (PgBouncer integrado en Neon); aceptable para MVP |
| DNI encriptado no buscable directamente | Buscar clientes por nombre/teléfono/email; DNI solo para verificación puntual |

## Migration Plan

Sistema greenfield — no hay migración de datos existentes. El despliegue inicial es:

1. Provisionar base de datos en Neon (entornos: `development`, `staging`, `production`)
2. Ejecutar `prisma migrate deploy` para crear schema
3. Activar RLS policies en PostgreSQL
4. Seed inicial: crear tenant superadmin
5. Deploy backend en Railway (variables de entorno: `DATABASE_URL`, `JWT_SECRET`, `R2_*`, `META_*`)
6. Deploy frontend en Vercel (variable: `NEXT_PUBLIC_API_URL`)
7. Configurar dominio y certificado SSL

Rollback: al ser greenfield, el rollback es simplemente no completar el deploy.

## Open Questions

- ¿El tenant puede personalizar la duración de los slots por sala, o es fija por producto?
- ¿Se necesita notificación al médico cuando se crea una reserva en su sala?
- ¿El PDF generado se envía también por email al cliente, o solo se descarga en consulta?
- ¿Las plantillas PDF por producto son las mismas para todos los tenants, o cada tenant puede tener las suyas?
