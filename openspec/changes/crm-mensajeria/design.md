# Design — crm-mensajeria

## Contexto reutilizado (ya existe, no se rehace)

- `apps/api/src/lib/email.ts`: `EmailClient` con `ResendEmailClient` (HTTP, sin SDK) y `LogEmailClient`; `emailConfigured`, `renderTemplate({{var}})`.
- `apps/api/src/lib/whatsapp.ts`: `WhatsAppClient.sendTemplate` con `MetaWhatsAppClient` (Graph API v20) y `LogWhatsAppClient`; `normalizePhone`, `buildTemplatePayload` (puros, con test).
- `lib/campaign-runner.ts`: `sendCampaign` idempotente, `contactFor` (consentimiento + medio), `customerVars`, contadores y `CampaignRecipient`.
- `lib/workflow-cron.ts`: reglas de renovación (`WorkflowRule`/`WorkflowExecution`), cron 08:00, reintentos, `markWorkflowConverted`.
- `routes/magic-link.ts`: `/link/generate` (token 30 d + `ShortLink` `/b/CODE`), confirmación por `aid`, auto-reserva.
- `routes/portal.ts`: `request-access` (modo provisional: devuelve `link` si `!emailConfigured`), auditoría.
- `routes/tenants.ts`: `/tenants/me/channels` (estado) y `/channels/:ch/test`; `safeConfig` oculta el token (`hasMetaWaToken`).
- Consentimiento: `Customer.acceptsEmail / acceptsSms / acceptsWhatsapp`; gating ya aplicado en campañas y en los botones manuales del front.
- `CustomerEvent` (type/channel/actor) para la traza en la ficha.

## Hallazgos de la revisión del back (estado en `main`, 2026-10-09)

| # | Hallazgo | Dónde | Efecto con envíos reales | Fase |
|---|---|---|---|---|
| 1 | Credenciales WhatsApp **por clínica** en `TenantConfig`, pero el cliente las lee del **env global** | `whatsapp.ts:66-72` vs `tenants.ts:187` | Pantalla "conectado" y nada sale | B |
| 2 | `metaWaAccessToken` se guarda **en claro**; la UI promete "cifrado" | `tenants.ts` PATCH / `settings/page.tsx` | Fuga de token si se filtra la BD | B |
| 3 | Renovación automática usa `signMagicLinkToken` (**24 h**) y reintenta cada 15 días; no usa enlace corto | `workflow-cron.ts:144-146` | Paciente abre al día siguiente → "enlace caducado"; URL larguísima en plantilla | B |
| 4 | Workflow **no comprueba consentimiento** (`acceptsWhatsapp`) ni deja `CustomerEvent` | `workflow-cron.ts:148-155` | Envíos a quien no consintió; sin traza | B |
| 5 | Campañas WHATSAPP/SMS se registran en consola pero cuentan como **SENT** | `campaign-runner.ts:42-48, 96-98` | Estadísticas falsas; el admin cree que envió | A |
| 6 | Campañas sin **throttling** ni lotes; envío secuencial inline en la petición HTTP | `campaign-runner.ts:85-103`, `campaigns.ts:79` | 429 del proveedor → FAILED en masa; timeouts | A |
| 7 | `runDueCampaigns` solo a las **08:00** | `workflow-cron.ts:21` | Programada a las 17:00 sale al día siguiente | A |
| 8 | Email: texto → HTML con `<br>` **sin escape**; sin **enlace de baja** ni `List-Unsubscribe` | `email.ts:34`, plantillas | HTML roto/inyectable; incumple LSSI en comerciales | A |
| 9 | Sin **webhooks**: ni rebotes/quejas (Resend) ni entregado/leído/respuestas/STOP (Meta) | — | Se sigue enviando a emails muertos; opt-out por WhatsApp ignorado; Meta exige webhook para configurar la app | B |
| 10 | `normalizePhone` solo quita no-dígitos: un móvil español de 9 cifras sin prefijo falla en Meta | `whatsapp.ts:19-21` (el front sí añade 34 en `waNorm`) | Envíos rechazados | B |
| 11 | **Ninguna confirmación** al paciente al crear/reservar una cita (público, magic link, recepción) ni recordatorio previo | `public.ts`, `magic-link.ts`, `appointments.ts` | El touchpoint más básico no existe | D |
| 12 | `MessageTemplate` sin `kind`; los textos transaccionales están **hardcodeados** en el front (confirmación, recuperación) y en `portal.ts` | — | No editables; duplicados | D |
| 13 | `emailConfigured`/cliente se evalúan **al arrancar** | `email.ts:62-64` | Cambiar variables requiere reinicio (Railway lo hace al guardar) — solo documentar | A |
| 14 | Faltan `RESEND_API_KEY` / `EMAIL_FROM` en `.env.example` | `apps/api/.env.example` | Onboarding confuso | A |
| 15 | Tests: hay `whatsapp.test.ts` (payload) y `campaign-attribution`; **no** hay tests de `campaign-runner`, `workflow-cron`, `email`, `portal` | `apps/api/test` | Sin red de seguridad al enchufar proveedores | A |
| 16 | Portal: "modo provisional" revela el enlace mientras `!emailConfigured` (salta la anti-enumeración) | `portal.ts:67-75` | Aceptable solo hasta Fase A; se apaga solo | A |

Lo que está **bien** y se conserva: la abstracción de clientes (Resend/Meta/Log), el gating de consentimiento en campañas y botones, `/link/generate` con token 30 d + enlace corto, `safeConfig` que nunca devuelve el token, auditoría del portal, rate-limit de `request-access` (5/10 min), `CustomerEvent` al pedir confirmación.

## Fase 0 — Modo demo (decisión: construir la tubería real con adaptador "demo")

Sin dominio ni proveedores, el valor demostrable está en que el CRM **decide y redacta** solo. Por eso la Fase 0 construye ya `MessageDelivery` + `notify` + `selectChannel` + plantillas del sistema, y un adaptador `demo` que **solo persiste** el mensaje renderizado (`provider: "demo"`, `status: SENT`). La pantalla "Comunicaciones" (ficha del paciente + bandeja global en Configuración) muestra esos avisos con vista previa por canal y enlaces **reales** (abren confirmación / reserva / portal). Reglas de honestidad: el chip dice **"Simulado"** cuando `provider = demo`; "Entregado/Leído" solo existen con proveedor real. Cuando un canal se configura, `notify` usa el cliente real y la misma pantalla muestra entregas reales: nada de la Fase 0 se tira.

Disparadores en Fase 0: `appointment_created`, `confirmation_requested`, `noshow_invite` (al registrar contacto desde Recuperar), `renewal_reminder` (workflow) y `portal_access`. Selección de canal: preferencia del evento → consentimiento → medio de contacto → disponibilidad (en demo todos los canales cuentan como "disponibles en modo demo", así se ve la elección real); `portal_access` ignora el consentimiento de marketing (mensaje de servicio).

## Arquitectura objetivo

```
lib/messaging/
  index.ts        notify(tenantId, customerId, event, vars, opts)  ← único punto de entrada transaccional
  clients.ts      emailFor(tenantId) / whatsappFor(tenantId) / smsFor(tenantId)   (cache por tenant, invalidada al PATCH config)
  email.ts        (actual) + sendHtml con layout y botón
  whatsapp.ts     (actual) + sendTemplate con botón URL dinámico, normalización E.164 por país del tenant
  sms.ts          SmsClient { send(to, text) } → LabsMobileSmsClient | LogSmsClient
  templates.ts    resolveTemplate(tenantId, kind, event, channel) → MessageTemplate (por clínica) con fallback a defaults del sistema
  queue.ts        cola en BD (MessageDelivery PENDING) + worker con throttling por proveedor y reintentos
routes/webhooks.ts   POST /webhooks/meta (verificación GET + estados + inbound), POST /webhooks/resend (rebotes/quejas)
```

### Selección de canal (transaccional)

`notify` recibe el **evento** y decide el canal con esta regla, en orden, usando solo canales **configurados** para la clínica y **consentidos** por el paciente:

1. Preferencia del evento (p. ej. acceso al portal → email primero; recordatorio → WhatsApp primero).
2. Si el canal preferido no está disponible/consentido → siguiente (WhatsApp → SMS → Email).
3. Si ninguno → `MessageDelivery` con estado `SKIPPED` + motivo, visible en la ficha (recepción puede actuar a mano con los botones actuales).

El **portal** es la excepción de consentimiento: el enlace de acceso es un mensaje de **servicio solicitado por el propio paciente** (interés legítimo/ejecución del servicio), por lo que se envía aunque `acceptsEmail` sea `false`; sí respeta `emailBouncedAt`.

### Clientes por clínica (decisión D1)

- `whatsappFor(tenantId)` lee `TenantConfig.metaWaPhoneNumberId` + `metaWaAccessToken` (descifrado) y cae a `LogWhatsAppClient` si faltan. El env global `META_WA_*` deja de usarse (se mantiene solo como **fallback de desarrollo** si no hay config de tenant).
- `emailFor(tenantId)`: **global** (Resend del servidor) en esta iteración; el nombre de la clínica va en el *display name* del remitente (`"{Clínica} vía MediRenova <no-reply@…>"`) y en el asunto. Preparado para `TenantConfig.emailFrom` más adelante.
- `smsFor(tenantId)`: por clínica (`smsApiKey` cifrada + `smsSender` alfanumérico, máx. 11 caracteres).

### Cifrado de secretos de configuración (decisión D4)

Nuevo helper `encryptSecret/decryptSecret` (AES-256-GCM, mismo formato `iv:tag:cipher` que `encryptDni`) con clave **propia** `CONFIG_ENCRYPTION_KEY` (64 hex). Migración de datos: cifrar los tokens existentes en claro (script idempotente: si no tiene formato `iv:tag:cipher`, cifrar). `safeConfig` sigue devolviendo solo `hasMetaWaToken` / `hasSmsApiKey`.

### Plantillas de WhatsApp (Meta)

- Meta solo permite **plantillas aprobadas** para mensajes iniciados por la empresa (fuera de la ventana de 24 h tras un mensaje del paciente). Se crean en Meta Business Manager (categoría *Utility* para transaccionales, *Marketing* para campañas) con **botón URL dinámico** (`https://{PUBLIC_URL}/b/{{1}}`) y variables de cuerpo cortas (`{{1}}` nombre, `{{2}}` producto, `{{3}}` fecha…).
- En el CRM: `MessageTemplate.channel = WHATSAPP` guarda `providerTemplateName`, `languageCode` y el **mapeo de variables** (`variables: ["nombre","producto","fecha","codigo"]`). El cuerpo de la plantilla se muestra como **vista previa** (no editable; lo aprobado manda).
- Campañas WhatsApp: selector de plantilla aprobada + variables; se elimina el texto libre para este canal.
- Plantillas iniciales a aprobar (textos propuestos en `tasks.md` B.2): `medirenova_renovacion`, `medirenova_confirmacion_cita`, `medirenova_recordatorio_cita`, `medirenova_recuperacion_noshow`, `medirenova_acceso_portal`.

### Enlaces en mensajes

- Todo enlace que viaja en un mensaje usa **token de 30 días** (`signConfirmationToken`) + **enlace corto** `/b/CODE` (`ShortLink`). Se extrae de `/link/generate` un helper `createShortBookingLink(tenantId, customerId, productId)` reutilizado por workflow, campañas y `notify`.
- El enlace de **acceso al portal** mantiene su token de 60 min (sesión) pero viaja también como corto (`/b/CODE` → `/mi-area/entrar?token=…`) para caber en SMS/WhatsApp; `ShortLink` pasa a tener `kind` (`booking` | `portal` | `confirm`).

### Consentimiento, baja y rebotes

- Campañas (comerciales): pie obligatorio con **enlace de baja** `/baja/CODE` (sin login, firma HMAC por cliente+canal) + cabecera `List-Unsubscribe` en email. La baja pone `acceptsEmail/Whatsapp/Sms = false` según el canal y registra `CustomerEvent` (`baja_<canal>`, actor `cliente`).
- WhatsApp entrante con texto `STOP`/`BAJA` (webhook) → `acceptsWhatsapp = false` + evento.
- Rebote duro/queja de Resend (webhook) → `Customer.emailBouncedAt` + evento; `notify` y campañas lo tratan como "sin medio de contacto".
- Transaccional: no lleva baja (es servicio), pero respeta consentimiento salvo el portal (ver arriba).

### Cola y throttling

- `MessageDelivery { id, tenantId, customerId, channel, provider, kind (CAMPAIGN|TRANSACTIONAL), event, to, templateId?, campaignId?, appointmentId?, providerMessageId?, status (PENDING|SENT|DELIVERED|READ|FAILED|SKIPPED|BOUNCED), error?, attempts, sentAt, updatedAt }`.
- Campañas: `POST /campaigns/:id/send` **encola** (no envía inline) y responde al instante; un worker (cron cada minuto) procesa `PENDING` por lotes con pausa por proveedor (Resend ≈ 2 req/s en plan básico; Meta según *tier*; SMS según proveedor) y reintento exponencial (3 intentos). Contadores de `Campaign` se actualizan desde la cola.
- Transaccional: `notify` encola igualmente (respuesta inmediata al usuario) salvo "Probar conexión", que envía inline.
- Cron de campañas programadas: cada **10 min** (`SCHEDULED` con `scheduledAt <= now` → encolar).

### Canales no disponibles

Hasta que un canal esté configurado para la clínica: crear/enviar una campaña por ese canal responde **409 `CHANNEL_UNAVAILABLE`** con mensaje claro; el front deshabilita la opción con el motivo. Nunca se contabiliza como enviado algo que no salió.

### Portal (ajuste del modo provisional)

`request-access`: si hay **algún** canal configurado se envía por `notify(event="portal_access")` (email → SMS → WhatsApp según medio disponible); el modo "revelar enlace" solo queda si **ningún** canal está configurado (desarrollo). Si la ficha no tiene email pero sí móvil y hay SMS/WhatsApp, el paciente recibe el enlace por ahí (cierra la limitación del MVP del portal).

## Endpoints nuevos / modificados

- `GET /tenants/me/channels` → añade `sms` real, `whatsapp.templates[]` (nombre, estado de aprobación cacheado), `email.from`.
- `POST /tenants/me/channels/whatsapp/test` → envía la plantilla `medirenova_test` al móvil del usuario admin (o `GET /{phoneNumberId}` para validar el token si no hay plantilla aún).
- `POST /tenants/me/channels/sms/test` → SMS al móvil del admin.
- `GET/POST/PATCH /message-templates` → añade `kind`, `providerTemplateName`, `variables`; listado de **transaccionales** con defaults del sistema (si la clínica no ha creado la suya, se usa la de sistema).
- `POST /webhooks/meta` (+ `GET` de verificación con `META_WA_VERIFY_TOKEN`), `POST /webhooks/resend` (firma `svix`). Fuera del prefijo autenticado; validan firma; idempotentes por `providerMessageId`.
- `GET /customers/:id/deliveries` → traza de envíos en la ficha (y se muestran en el historial junto a `CustomerEvent`).
- `GET /baja/:code` (web) + `POST /unsubscribe/:code` (API pública).

## Eventos transaccionales (Fase D)

| Evento | Disparador | Canal preferido | Plantilla por defecto |
|---|---|---|---|
| `appointment_created` | alta de cita (recepción, público, magic link, reagendado) | WhatsApp → SMS → Email | "Tu cita de {producto} es el {fecha} a las {hora} en {centro}. {enlace_confirmar}" |
| `appointment_reminder` | cron, 24 h antes (configurable `reminderHoursBefore`) | WhatsApp → SMS → Email | recordatorio + confirmar/no podré ir |
| `confirmation_requested` | botón "Pedir confirmación" (sustituye al manual; el manual queda como respaldo) | WhatsApp → Email | actual |
| `noshow_invite` | al marcar `NO_SHOW` (manual o auto), opt-in por clínica `autoInviteOnNoShow` | WhatsApp → Email | texto opción A actual |
| `renewal_reminder` | workflow de renovación | WhatsApp → SMS → Email | plantilla de renovación |
| `portal_access` | `request-access` | Email → SMS → WhatsApp | actual |

Cada envío deja `MessageDelivery` + `CustomerEvent` (`aviso_enviado`, channel) y, si el paciente actúa por el enlace, los eventos ya existentes (`cliente_confirmo`, etc.).

## Decisiones (propuestas; pendientes de confirmar)

- **D1 — Credenciales WhatsApp por clínica** (cada centro tiene su número/WABA). Alternativa: globales del servidor (más simple, un solo número para todos; no escala a varios clientes SaaS).
- **D2 — Email global del servidor ahora** (una cuenta Resend, `EMAIL_FROM` de MediRenova, nombre de la clínica en remitente/asunto). Más adelante: dominio propio por clínica (`TenantConfig.emailFrom` + verificación de dominio en Resend).
- **D3 — Proveedor SMS: LabsMobile** (API HTTP simple, remitente alfanumérico, precios España). Alternativas: Esendex, Twilio. Se decide al iniciar la Fase C; el adaptador aísla el cambio.
- **D4 — Clave de cifrado propia `CONFIG_ENCRYPTION_KEY`** para secretos de configuración (no reutilizar `DNI_ENCRYPTION_KEY`: distinta rotación y distinto dato).
- **D5 — Envíos por cola** (BD + worker) en vez de inline, incluso para transaccional, salvo "Probar conexión".
- **D6 — Prioridad de canal** para transaccional: WhatsApp → SMS → Email (salvo portal: Email primero). Configurable por clínica más adelante.

## Riesgos / notas

- **Aprobación de plantillas Meta: 48-72 h** y pueden rechazar textos con enlaces "acortados" genéricos; usar dominio propio en el botón URL. Empezar el trámite el primer día de la Fase B.
- **Límites de Meta**: el número nuevo empieza con *tier* de 250 conversaciones/24 h; sube con uso y calidad. Las campañas grandes deben respetarlo (throttling + mensaje claro al admin).
- **Resend**: dominio verificado (SPF/DKIM/DMARC) obligatorio para no caer en spam; límite de velocidad según plan (la cola lo absorbe).
- **Variables de entorno en Railway**: cambiarlas reinicia el servicio (el cliente de email se crea al arrancar).
- **Neon**: la contraseña expuesta sigue pendiente de rotación (fuera de este change pero prioritaria).
- Mientras el email no esté configurado, el portal sigue en modo provisional (PR #14); **no** desplegar la Fase D sin haber cerrado la A.
