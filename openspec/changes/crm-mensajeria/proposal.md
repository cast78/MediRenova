## Why

El CRM ya **genera** todos los enlaces que el paciente necesita (reserva por magic link, confirmación de cita, recuperación de no-show, acceso al portal, renovación) y tiene la **abstracción** de clientes de envío (`email.ts` → Resend, `whatsapp.ts` → Meta Cloud API, con adaptadores de consola para desarrollo). Pero en producción **ningún mensaje sale de verdad**:

- **Email**: el cliente Resend está implementado, pero faltan `RESEND_API_KEY` / `EMAIL_FROM` en el servidor → todo va a consola. Esto bloquea el **acceso al portal del paciente** (hoy en "modo provisional" que revela el enlace en pantalla, PR #14), las **campañas por email** y los **avisos de fin de día**.
- **WhatsApp**: el cliente Meta solo envía **plantillas** (lo correcto: Meta no permite texto libre iniciado por la empresa), pero no hay plantillas aprobadas y, además, hay un **desajuste**: Configuración guarda las credenciales **por clínica** (`TenantConfig`) y el cliente las lee del **env global** → la pantalla dice "conectado" y los envíos siguen en consola.
- **SMS**: no existe proveedor (`sms.ts` no existe; Configuración lo marca "off").

La revisión del back (ver `design.md`) ha destapado además huecos que conviene cerrar **antes** de activar canales reales, porque con envíos simulados no se notan pero con envíos reales sí: campañas WhatsApp/SMS que se contabilizan como **enviadas** sin serlo, el enlace de **renovación automática caduca en 24 h** aunque se reintente cada 15 días, el **token de Meta se guarda en claro** aunque la interfaz promete cifrado, ausencia de **throttling** en campañas, sin enlace de **baja** en comunicaciones comerciales, sin **webhooks** de entrega/rebote/respuesta, y **ninguna confirmación** al paciente cuando reserva.

## What Changes

Activación de la mensajería real **por fases**, cada una desplegable de forma independiente:

- **Fase A — Email real (Resend)**: configuración del proveedor (dominio verificado, variables en Railway), email HTML con botón, arreglos de base en campañas (throttling, cron de campañas cada 10 min, bloqueo de canales no disponibles), pie de **baja** en campañas, tests del núcleo. Con esto el portal **deja de revelar el enlace** y lo envía por email.
- **Fase B — WhatsApp real (Meta Cloud API)**: cliente **por clínica** (credenciales de `TenantConfig`, cifradas), normalización E.164, catálogo de **plantillas aprobadas** por Meta (renovación, confirmación, recuperación, acceso portal), campañas WhatsApp por plantilla + variables, renovación automática con **token de 30 días + enlace corto** y comprobación de consentimiento, **webhook** de Meta (verificación, estados de entrega, respuestas entrantes y baja "STOP"), "Probar conexión" real.
- **Fase C — SMS (proveedor español)**: adaptador `sms.ts` con el mismo patrón, campañas SMS reales, SMS como canal alternativo de acceso al portal cuando la ficha no tiene email.
- **Fase D — Avisos transaccionales automáticos**: servicio único `notify(evento)` que elige canal por consentimiento y disponibilidad; `MessageTemplate.kind` (`CAMPAIGN` | `TRANSACTIONAL`) editable en **Configuración → Plantillas de avisos**; eventos: cita creada (confirmación), recordatorio previo, pedir confirmación, no-show (invitación proactiva), renovación, acceso al portal; traza `CustomerEvent` con canal.

**No-goals:**
- Chat bidireccional con el paciente (bandeja de conversaciones WhatsApp). Solo se procesan respuestas de **baja/opt-out** y estados de entrega.
- Credenciales de **email por clínica** (dominio propio de cada centro): el remitente es global del servidor en esta iteración (ver decisión D2).
- Pago online y preferencias de aviso del paciente en el portal (Fase 2 del portal).

## Capabilities

### New Capabilities

- `crm-mensajeria`: Envío real de comunicaciones al paciente por email, WhatsApp y SMS, con proveedores enchufables, credenciales por clínica cifradas, plantillas aprobadas, consentimiento RGPD y baja, trazabilidad de entregas y un servicio transaccional único para los eventos del ciclo de vida de la cita.

### Modified Capabilities

- `crm-portal-paciente`: el enlace de acceso se envía por email (y SMS/WhatsApp como alternativa); el "modo provisional" de revelar el enlace se desactiva automáticamente.
- `campañas` (medirenova-crm-core §12/§13): canales WhatsApp y SMS pasan de simulados a reales; throttling; baja; bloqueo de canales no disponibles; cron propio.
- `workflow de renovación` (medirenova-crm-core §12): enlace de 30 días + corto, consentimiento, traza; cliente WhatsApp por clínica.
- `crm-recuperacion-no-show`: su Fase 2 (plantillas editables + aviso proactivo) se absorbe en la Fase D de este change.

## Impact

- **Modelos → migraciones (aditivas)**: `MessageTemplate.kind` + `providerTemplateName` + `variables`; `MessageDelivery` (traza por envío: canal, proveedor, id externo, estado, error); `Customer.emailBouncedAt` / `whatsappOptOutAt`; `TenantConfig.metaWaAccessToken` pasa a cifrado (migración de datos) + `metaWaBusinessAccountId` + `smsApiKey` (cifrado) + `smsSender`.
- **Backend**: `lib/messaging/` (clientes por tenant, `notify`, cola ligera con throttling), `routes/webhooks.ts` (Meta, Resend), ajustes en `campaign-runner`, `workflow-cron`, `portal`, `tenants` (cifrado + prueba real), nuevo cron de campañas.
- **Frontend**: Configuración → canales (WhatsApp: plantillas aprobadas; SMS: proveedor y remitente; Email: estado) y **Plantillas de avisos** (transaccionales editables con variables); Campañas WhatsApp: selector de plantilla en vez de texto libre.
- **Operación (pasos manuales del administrador)**: cuenta Resend + DNS del dominio; Meta Business + número + token permanente + aprobación de plantillas (48-72 h); cuenta del proveedor SMS. Están enumerados como tareas "(tú)" en `tasks.md`.
- **Seguridad/RGPD**: el modo "revelar enlace" del portal deja de aplicar; tokens de proveedor cifrados en BD; baja y opt-out respetados en todos los canales; traza de entregas en la ficha del cliente.
