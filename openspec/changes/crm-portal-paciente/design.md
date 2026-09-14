# Design — crm-portal-paciente

## Contexto: qué se reutiliza y qué se construye

El portal se apoya en infraestructura que **ya existe** (ver mapeo del código):

| Bloque | Existe hoy | Uso en el portal |
|---|---|---|
| Firma/verify JWT | `lib/jwt.ts` (`signMagicLinkToken`/`verifyMagicLinkToken`, HS256, `JWT_SECRET`) | Base para un **token de portal** nuevo (`type: "portal"`). |
| Exención de rutas públicas | `plugins/auth.ts` exime `/api/v1/link/*` del auth de staff | Mismo patrón para `/portal/*`. |
| PDF del certificado | `lib/pdf.ts` → `ensureRevisionPdf(revisionId, tenantId)` (idempotente, por tenant) | Descarga del PDF del paciente (tras verificar dueño). |
| Almacenamiento | `lib/storage.ts` (interfaz `Storage`; hoy solo `LocalStorage`; R2 previsto, no implementado) | Servir el PDF; **R2 + URLs firmadas** para producción. |
| Páginas públicas `[token]` | `app/booking/[token]`, `app/confirmar/[token]` (sin layout de staff, vía proxy `/api/proxy`) | Patrón para `app/mi-area/**`. |
| Aislamiento por tenant | `lib/tenant-context.ts` + extensión Prisma (`lib/prisma.ts`) inyecta `where:{tenantId}` | Se usa, **pero no basta** (ver Seguridad). |
| Rate-limit global | `@fastify/rate-limit` 300/min | Cubre por defecto; se añade límite específico en "solicitar enlace". |

**A construir nuevo:** (1) token/sesión de portal multi-recurso + flujo de solicitud de acceso iniciado por el paciente; (2) endpoints de portal (mis revisiones / mis citas / mi PDF) con **filtro por `customerId`**; (3) scoping por `customerId` (hoy no existe); (4) segmento frontend `app/mi-area`; (5) rate-limit/anti-enumeración; (6) para prod, adaptador R2 + URLs firmadas.

## Acceso sin contraseña (los pacientes no tienen cuenta)

Flujo de acceso (passwordless, iniciado por el paciente):

1. **Solicitud** — El paciente abre `mi-area/<slug-del-centro>` e introduce **DNI + fecha de nacimiento** (identidad "algo que sabe"). El backend busca el `Customer` por `dniHash` + `birthDate` dentro de ese tenant.
2. **Envío del enlace** — Si hay coincidencia, se envía un **enlace mágico** al **contacto que ya consta en ficha** (email y/o SMS según preferencias/consentimiento), **nunca a un contacto tecleado por el solicitante** (evita secuestro). Respuesta **siempre** "si hay coincidencia, te hemos enviado un enlace" (anti-enumeración).
3. **Sesión de portal** — El enlace lleva un token corto; al abrirlo, el backend lo canjea por un **token de sesión de portal** (`type: "portal"`, `cid`+`tid`, caducidad corta, p. ej. 30–60 min) guardado en el cliente. Ese token da acceso a **los recursos del paciente** (sus revisiones, sus citas), no a un solo recurso como el magic-link actual.

Doble factor: el DNI+fecha (algo que sabe) + acceso al contacto de ficha (algo que tiene) constituyen una verificación razonable para dato clínico. Configurable por tenant si se quiere endurecer.

## Endpoints (MVP)

Grupo `/portal/*`, exento del auth de staff, cada handler **verifica el token de portal** y filtra por `token.cid`:

- `POST /portal/request-access` — body `{ dni, birthDate }`; envía enlace al contacto de ficha. Rate-limit estricto por IP/DNI. Respuesta genérica.
- `POST /portal/session` — canjea el token del enlace por una sesión de portal.
- `GET /portal/me` — datos mínimos del paciente (nombre, centro) para la cabecera.
- `GET /portal/revisions` — **mis** revisiones completadas (producto, fecha, outcome, caducidad, si tiene PDF). `where: { tenantId: token.tid, customerId: token.cid }`.
- `GET /portal/revisions/:id/pdf` — descarga; **verifica `revision.customerId === token.cid && revision.tenantId === token.tid`** antes de `ensureRevisionPdf`.
- `GET /portal/appointments` — **mis** citas (próximas + historial), mismo filtro por `customerId`.

## Frontend

Nuevo segmento `app/mi-area/`:
- Layout **ligero propio** (branding del centro: logo/color de `tenants/me/branding`), sin sidebar de staff. **Mobile-first.**
- Vistas: **Solicitar acceso** (DNI + fecha) · **Mis reconocimientos** (lista + descargar) · **Mis citas** (próximas/historial). El token de sesión se guarda en memoria/`sessionStorage` y se manda como `Authorization` a `/api/proxy/portal/...`.

## Seguridad y RGPD (crítico)

- **La RLS de Postgres está DEFINIDA pero INERTE**: `rls-setup.sql` existe, pero **no se ejecuta `SET LOCAL app.tenant_id`** en runtime, así que no aísla nada hoy. **No confiar en ella.** El aislamiento efectivo es la extensión Prisma (por tenant) + los `where` explícitos.
- **La extensión Prisma filtra por tenant, NO por customer.** Por tanto, **cada consulta del portal MUST incluir `customerId: token.cid`** explícito; sin eso, un paciente vería datos de otros pacientes del mismo centro. Es la regla de oro del módulo.
- **Descarga de PDF**: verificar dueño (`revision.customerId === token.cid`) antes de servir. Nunca exponer el PDF por URL adivinable sin ese chequeo.
- **Anti-enumeración**: `request-access` responde igual haya o no coincidencia; rate-limit por IP y por DNI; el enlace va solo al contacto de ficha.
- **Sesiones cortas** + posibilidad de revocar; **auditoría** de accesos y descargas en `audit_logs` (actor = el propio cliente, acción de lectura/descarga).
- **Dato clínico (art. 9 RGPD)**: minimización (solo lo del paciente), transporte HTTPS, y registro de acceso. El certificado es del paciente; el portal es el canal formal de su derecho de acceso.
- **Producción**: mover el PDF a **R2 con URLs firmadas de corta vida** (hoy `LocalStorage` sirve del disco del servidor); la interfaz `Storage`/`getSignedUrl` ya lo contempla.

## Decisiones (confirmadas)

1. **Ámbito MVP** = reconocimientos (ver + descargar) + historial de citas, **solo lectura**. Self-service (reservar/reprogramar) → **fase 2**. ✅
2. **Verificación de acceso** = **DNI + fecha de nacimiento** (ambos obligatorios) para identificar al cliente, y **enlace mágico al contacto de ficha** como factor "algo que tienes". Ambos campos deben coincidir con la ficha; el enlace se envía solo al email/teléfono almacenado. ✅
3. **Nombre** = "Portal del paciente" (capacidad) / **"Mi área"** (etiqueta al usuario). Ruta `/mi-area`. ✅
4. **Identificador en URL** = ninguno del cliente en claro; el `cid` viaja **dentro del token firmado**. No hace falta id público nuevo. ✅

## Fuera de alcance (de este change)

- Cuentas con contraseña / login clásico del paciente.
- Reservar/reprogramar/cancelar desde el portal (fase 2).
- Pagos, valoraciones, mensajería con el centro.
- Gestión de "familiares"/múltiples titulares bajo un mismo acceso.
- Activar la RLS real (`SET LOCAL app.tenant_id`) — recomendable como defensa en profundidad, pero es un trabajo transversal separado.
