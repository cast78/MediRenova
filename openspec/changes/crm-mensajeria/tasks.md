> **Estado (2026-10-09):** Fase 0 (modo demo) **completada y en producción** (PR #15). Las Fases A–D (envío real por Resend/Meta/SMS, cola, webhooks, avisos automáticos) quedan **pospuestas a la fase de madurez del producto**, tras `crm-planes` (Esencial/Pro). Requisito previo para retomarlas: dominio propio (ver `docs/mensajeria.md`).

Leyenda: **(tú)** = paso manual del administrador fuera del código · sin marca = implementación.

## 0. Decisiones previas

- [ ] 0.1 Confirmar D1–D6 de `design.md` (credenciales WhatsApp por clínica; email global; proveedor SMS; clave de cifrado propia; cola; prioridad de canal)
- [ ] 0.2 **(tú)** Rotar la contraseña de Neon expuesta (Neon + Railway + `.env` local) — previo a cualquier despliegue

## Fase 0 — Modo demo (buzón de comunicaciones simulado)

Objetivo: enseñar el potencial sin proveedores ni dominio. El sistema **redacta** el aviso, **elige el canal** (consentimiento × disponibilidad × preferencia) y lo **guarda** tal y como lo recibiría el paciente; la pantalla "Comunicaciones" lo muestra. Es la misma tubería (`MessageDelivery` + `notify`) que usarán los envíos reales: al configurar un canal, solo cambia el adaptador. Mockup aprobado: canvas "Comunicaciones — mockup".

### 0.A Modelo y núcleo

- [x] 0.A.1 Migración `MessageDelivery` (`tenantId`, `customerId`, `appointmentId?`, `event`, `channel`, `provider` (`demo`|`resend`|`meta`|`sms`), `status` (`SENT`|`DELIVERED`|`READ`|`FAILED`|`SKIPPED`), `to`, `subject?`, `body`, `cta?`, `link?`, `templateName?`, `vars` Json, `reason?`, `byUserId?`, `sentAt`, timestamps) + enums; añadir a `TENANT_SCOPED_MODELS` y al test de aislamiento
- [x] 0.A.2 `lib/messaging/select-channel.ts` (puro): `selectChannel({ prefer, consent, contact, available })` → canal o `null` + motivo; excepción de servicio para `portal_access`
- [x] 0.A.3 `lib/messaging/templates.ts`: textos por defecto del sistema por evento × canal (WhatsApp/SMS/Email con asunto y CTA) + `render(event, channel, vars)`
- [x] 0.A.4 `lib/messaging/short-link.ts`: `createShortLink(kind, token, days)` extraído de `/link/generate`; `ShortLink.kind` (`booking`|`confirm`|`portal`) y la página `/b/[code]` redirige según `kind`
- [x] 0.A.5 `lib/messaging/notify.ts`: `notify({ tenantId, customerId, event, vars, appointmentId?, byUserId?, prefer? })` → elige canal, renderiza, persiste `MessageDelivery`; adaptador `demo` cuando el canal no está configurado (solo guarda, `status: SENT`, `provider: demo`); con proveedor configurado envía con el cliente existente y guarda el resultado
- [x] 0.A.6 Tests: `selectChannel` (matriz consentimiento × medio × disponibilidad × excepción portal), `render` (variables y CTA por canal)

### 0.B Disparadores

- [x] 0.B.1 `appointment_created`: alta de cita en recepción (`POST /appointments` y reagendado), reserva pública (`public.ts`) y magic link (`confirm` / `reschedule`) → aviso con enlace corto de confirmar / no podré ir (token 30 d con `aid`)
- [x] 0.B.2 `confirmation_requested`: el endpoint de "Pedir confirmación" registra el aviso (los botones manuales del front siguen como respaldo)
- [x] 0.B.3 `noshow_invite`: al registrar "contactado" con vía WhatsApp/Email desde Recuperar se guarda el aviso con el texto de invitación y el enlace generado
- [x] 0.B.4 `renewal_reminder`: el workflow de renovación pasa por `notify` (consentimiento + enlace corto 30 d + traza); cierra los hallazgos 3-4 del back
- [x] 0.B.5 `portal_access`: `request-access` registra el aviso (email preferente, excepción de servicio); el modo "revelar enlace" se mantiene hasta la Fase A

### 0.C API de consulta

- [x] 0.C.1 `GET /customers/:id/deliveries` (RECEPTIONIST): avisos del paciente, más recientes primero
- [x] 0.C.2 `GET /deliveries?from&to&channel&event&status&q` + `GET /deliveries/summary?date` (ADMIN): bandeja global y KPIs del día (generados por canal · entregados · leídos · omitidos · fallidos)
- [x] 0.C.3 `GET /tenants/me/channels` indica `mode: "demo" | "live"` por canal

### 0.D Frontend

- [x] 0.D.1 Ficha del paciente → pestaña **Comunicaciones** (contador en la pestaña): aviso ámbar de modo demo, chips de consentimiento en cabecera, lista (icono de canal, evento, título, origen sistema/recepción, estado con color), filtros por canal
- [x] 0.D.2 Vista previa por canal (burbuja WhatsApp con botón de enlace, email con remitente/asunto/botón, SMS con contador) + detalle (evento, canal, plantilla, variables, enlace y validez, seguimiento, motivo si omitido/fallido) + "Abrir como el paciente" y "Copiar texto"
- [x] 0.D.3 Configuración → **Comunicaciones**: 5 KPIs del día con color, filtros (canal/evento/estado/periodo/buscador), tabla con "Ver →" a la ficha, tarjetas de estado de canales (Simulado / Conectado) con "Configurar →"
- [x] 0.D.4 El chip de estado muestra **"Simulado"** (ámbar) cuando `provider = demo`; nunca se inventan "Entregado/Leído" sin proveedor real

### 0.E Verificación

- [x] 0.E.1 Typecheck API + web; tests en verde
- [ ] 0.E.2 E2E demo: crear cita → aparece en Comunicaciones (WhatsApp si consiente, si no el siguiente canal; omitido con motivo si ninguno) → "Abrir como el paciente" confirma la cita; marcar no-show y registrar contacto → aviso guardado; pedir acceso al portal → aviso de email guardado

## Fase A — Email real (Resend) + base sólida

### A.1 Proveedor (manual)

- [ ] A.1.1 **(tú)** Crear cuenta en Resend; añadir el dominio y los registros DNS (SPF, DKIM, DMARC); esperar verificación
- [ ] A.1.2 **(tú)** Crear API key; en Railway añadir `RESEND_API_KEY` y `EMAIL_FROM` (`MediRenova <no-reply@tudominio.es>`); comprobar `PUBLIC_URL` = URL real del front
- [ ] A.1.3 **(tú)** Configuración → Email → **Probar conexión** (llega el email de prueba al admin)

### A.2 Código

- [x] A.2.1 `.env.example`: añadir `RESEND_API_KEY`, `EMAIL_FROM`, `CONFIG_ENCRYPTION_KEY`, `META_WA_VERIFY_TOKEN`, `RESEND_WEBHOOK_SECRET`
- [ ] A.2.2 `email.ts`: `sendEmail({ html? })` con layout HTML (logo/color de la clínica, botón, pie) y **escape** del texto; `renderTemplate` sigue para variables
- [ ] A.2.3 Portal: email de acceso en HTML con botón "Entrar en mi área"; el modo provisional solo si ningún canal está configurado (ajuste en `request-access`)
- [ ] A.2.4 Campañas: `POST /campaigns/:id/send` y canales no configurados → **409 `CHANNEL_UNAVAILABLE`**; nunca contar como SENT un canal simulado (hallazgo 5)
- [ ] A.2.5 Modelo `MessageDelivery` + migración; `campaign-runner` encola y un worker (cron 1 min) envía por lotes con pausa y reintentos (hallazgo 6); contadores de campaña desde la cola
- [ ] A.2.6 Cron de campañas programadas cada 10 min, separado del job de 08:00 (hallazgo 7)
- [ ] A.2.7 Pie de **baja** en campañas por email (`/baja/CODE`, HMAC) + `List-Unsubscribe`; endpoint público `POST /unsubscribe/:code` y página web `/baja/[code]`; `CustomerEvent` `baja_email` (hallazgo 8)
- [ ] A.2.8 Webhook Resend (`POST /webhooks/resend`, firma): rebote duro/queja → `Customer.emailBouncedAt` + evento; `contactFor` y `notify` lo respetan (hallazgo 9, parte email)
- [ ] A.2.9 Front Configuración → Email: estado real, remitente, última prueba; Campañas: aviso "canal no disponible" con motivo
- [ ] A.2.10 Tests: `contactFor` (consentimiento + rebote), `deliver` con cliente inyectado, worker (lotes/reintentos), `renderTemplate` + escape, `request-access` (modo provisional on/off)

### A.3 Verificación

- [ ] A.3.1 Typecheck API + web; tests en verde
- [ ] A.3.2 E2E manual: solicitar acceso al portal → llega email → entra; campaña email a segmento de prueba → recibidos, contadores correctos, baja funciona
- [ ] A.3.3 Comprobar en producción que el portal **ya no revela** el enlace

## Fase B — WhatsApp real (Meta Cloud API)

### B.1 Proveedor (manual, arrancar el día 1 por los plazos)

- [ ] B.1.1 **(tú)** Meta Business Suite: cuenta de empresa verificada → WhatsApp Business Account → número (no puede estar en WhatsApp personal) → *System User* con token **permanente** → anotar Phone Number ID y WABA ID
- [ ] B.1.2 **(tú)** Crear y enviar a aprobación las plantillas (categoría *Utility* salvo campañas → *Marketing*), idioma `es`, con botón URL dinámico `https://{dominio}/b/{{1}}`:
  - `medirenova_renovacion`: "Hola {{1}}, tu {{2}} caduca el {{3}}. Reserva tu renovación en un minuto: [botón]"
  - `medirenova_confirmacion_cita`: "Hola {{1}}, tu cita de {{2}} es el {{3}} a las {{4}} en {{5}}. Confirma o avísanos si no podrás ir: [botón]"
  - `medirenova_recordatorio_cita`: "Hola {{1}}, te recordamos tu cita de {{2}} mañana a las {{3}} en {{4}}. [botón]"
  - `medirenova_recuperacion_noshow`: "Hola {{1}}, tu {{2}} del {{3}} sigue pendiente. Elige nueva fecha cuando te venga bien: [botón]"
  - `medirenova_acceso_portal`: "Hola {{1}}, aquí tienes tu acceso a tu área de paciente (válido 60 min): [botón]"
  - `medirenova_test`: "Prueba de conexión de MediRenova para {{1}}. Si lo recibes, el canal funciona."
- [ ] B.1.3 **(tú)** En la app de Meta, configurar el webhook (`{API_URL}/webhooks/meta`, verify token) y suscribir `messages` (requiere B.2.6 desplegado)

### B.2 Código

- [ ] B.2.1 `encryptSecret/decryptSecret` (`CONFIG_ENCRYPTION_KEY`); PATCH de `TenantConfig` cifra `metaWaAccessToken`; script idempotente que cifra los valores existentes en claro (hallazgo 2)
- [ ] B.2.2 `whatsappFor(tenantId)` con credenciales de `TenantConfig` (cache + invalidación al PATCH); env global solo como fallback de desarrollo (hallazgo 1)
- [ ] B.2.3 Normalización **E.164** por país de la clínica (`TenantConfig.defaultCountryCode`, por defecto 34) compartida con el front (hallazgo 10)
- [ ] B.2.4 `MessageTemplate`: `kind`, `providerTemplateName`, `languageCode`, `variables[]`; migración; CRUD; vista previa del cuerpo aprobado
- [ ] B.2.5 Campañas WhatsApp: plantilla aprobada + variables en vez de texto libre; `deliver` real vía cola; 409 si la clínica no tiene WhatsApp configurado
- [ ] B.2.6 Webhook Meta (`GET` verificación, `POST` firmado `X-Hub-Signature-256`): estados `sent/delivered/read/failed` → `MessageDelivery`; entrante `STOP/BAJA` → `acceptsWhatsapp=false` + evento (hallazgo 9)
- [ ] B.2.7 Workflow de renovación: `createShortBookingLink` (token 30 d + `/b/CODE`), comprobar `acceptsWhatsapp` y teléfono, `CustomerEvent` + `MessageDelivery`, envío por cola (hallazgos 3-4)
- [ ] B.2.8 "Probar conexión" real: envía `medirenova_test` al móvil del admin (o valida el token contra `GET /{phoneNumberId}` si aún no hay plantilla)
- [ ] B.2.9 Front Configuración → WhatsApp: Phone Number ID, WABA ID, token (cifrado), lista de plantillas con estado; Campañas: selector de plantilla
- [ ] B.2.10 Tests: cifrado, `whatsappFor` (fallback), E.164, mapeo de variables, verificación/firma del webhook, opt-out

### B.3 Verificación

- [ ] B.3.1 Prueba de conexión OK; plantilla de renovación recibida en un móvil de prueba con enlace corto que abre `/booking`
- [ ] B.3.2 Campaña WhatsApp a 2-3 clientes de prueba: entregados/leídos reflejados; "STOP" desactiva el consentimiento
- [ ] B.3.3 Workflow: ejecutar `runWorkflowJob` en una clínica de prueba y comprobar `SENT` real + traza

## Fase C — SMS (proveedor español)

- [ ] C.1 **(tú)** Cuenta en el proveedor elegido (D3); remitente alfanumérico "MediRenova" (máx. 11 car.); API key
- [ ] C.2 `sms.ts`: `SmsClient` + adaptador del proveedor + `LogSmsClient`; `smsFor(tenantId)` con `smsApiKey` (cifrada) y `smsSender` en `TenantConfig`
- [ ] C.3 Campañas SMS reales vía cola (160 car./concatenación; aviso de coste estimado antes de enviar); pie de baja corto (`/baja/CODE`)
- [ ] C.4 Portal: SMS como canal de acceso cuando la ficha no tiene email (enlace corto `/b/CODE` → `/mi-area/entrar`)
- [ ] C.5 Configuración → SMS: proveedor, remitente, API key, "Probar conexión" (SMS al admin)
- [ ] C.6 Tests: adaptador (mock HTTP), longitud/concatenación, selección de canal con SMS

## Fase D — Avisos transaccionales automáticos

- [ ] D.1 `notify(tenantId, customerId, event, vars)`: selección de canal (D6) por consentimiento + disponibilidad + rebotes; encola `MessageDelivery`; `CustomerEvent` `aviso_enviado`
- [ ] D.2 Plantillas transaccionales por defecto del sistema (email/WhatsApp/SMS) + **Configuración → Plantillas de avisos** (editables por clínica, variables documentadas, vista previa)
- [ ] D.3 `appointment_created`: disparar en alta de cita (recepción, público, magic link, reagendado) con enlace de confirmar/no podré ir
- [ ] D.4 `appointment_reminder`: cron horario; `TenantConfig.reminderHoursBefore` (por defecto 24); no repetir; omitir si ya confirmada y la clínica así lo configura
- [ ] D.5 `confirmation_requested`: el botón "Pedir confirmación" envía por servidor (el manual WhatsApp/Email/Copiar queda como respaldo)
- [ ] D.6 `noshow_invite`: al marcar `NO_SHOW` (manual/auto) si `TenantConfig.autoInviteOnNoShow`; sella `NoShowRecovery.state=CONTACTED` con canal `auto` (cierra la Fase 2 de crm-recuperacion-no-show)
- [ ] D.7 `renewal_reminder` pasa por `notify` (el workflow deja de hablar con el cliente de WhatsApp directamente)
- [ ] D.8 Ficha del cliente: pestaña/sección **Comunicaciones** con `MessageDelivery` (canal, estado, cuándo, error) junto al historial
- [ ] D.9 Tests: selección de canal (matriz consentimiento × disponibilidad × rebote), no duplicar recordatorios, defaults vs plantilla de clínica
- [ ] D.10 E2E: crear cita → llega confirmación; marcar no-show → llega invitación y la fila sale "Contactada (auto)"; recordatorio 24 h antes

## Documentación

- [ ] E.1 Actualizar `crm-portal-paciente/tasks.md` (limitación "solo email" resuelta en C.4) y `crm-recuperacion-no-show/tasks.md` (Fase 2 → D.2/D.6)
- [x] E.2 Guía de operación para el administrador: alta de Resend, Meta y SMS paso a paso (con capturas) en `docs/mensajeria.md`
