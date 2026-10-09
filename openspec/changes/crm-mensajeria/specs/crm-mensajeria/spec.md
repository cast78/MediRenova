## ADDED Requirements

### Requirement: Buzón de comunicaciones con modo demo
El sistema SHALL redactar cada aviso al paciente, elegir su canal y registrarlo en `MessageDelivery` aunque no haya ningún proveedor configurado (adaptador `demo`), y SHALL mostrarlo en la ficha del paciente (pestaña "Comunicaciones") y en una bandeja global (Configuración → Comunicaciones) con vista previa por canal y enlaces funcionales. Un aviso simulado MUST mostrarse como "Simulado" y MUST NOT presentarse como entregado o leído.

#### Scenario: Cita creada sin proveedores configurados
- **WHEN** recepción crea una cita a un paciente que consiente WhatsApp y la clínica no tiene ningún canal configurado
- **THEN** aparece en Comunicaciones un aviso "Cita creada" por WhatsApp con estado "Simulado", cuya vista previa muestra el texto y el enlace de confirmación, y el enlace abre la página de confirmar

#### Scenario: Sin consentimiento en el canal preferente
- **WHEN** el paciente no consiente WhatsApp pero sí SMS
- **THEN** el aviso se registra por SMS y el detalle indica por qué no salió por WhatsApp

#### Scenario: Canal real configurado
- **WHEN** la clínica configura el email y se dispara un aviso cuyo canal elegido es email
- **THEN** el mismo aviso se envía por el proveedor y la pantalla muestra su estado real en lugar de "Simulado"

### Requirement: Canales de envío reales y enchufables por clínica
El sistema SHALL enviar comunicaciones al paciente por **email**, **WhatsApp** y **SMS** mediante clientes de proveedor intercambiables (Resend, Meta Cloud API, proveedor SMS) resueltos **por clínica** (`TenantConfig`) con un adaptador de consola cuando el canal no está configurado. El sistema MUST NOT contabilizar como enviado ningún mensaje que no haya sido aceptado por el proveedor.

#### Scenario: Canal configurado
- **WHEN** una clínica tiene credenciales válidas de WhatsApp y se envía una plantilla a un paciente
- **THEN** el mensaje se entrega al proveedor y queda registrado como `SENT` con el identificador del proveedor

#### Scenario: Canal no configurado
- **WHEN** una clínica sin SMS configurado intenta enviar una campaña por SMS
- **THEN** el sistema responde `409 CHANNEL_UNAVAILABLE` y la campaña no cambia de estado ni suma envíos

### Requirement: Secretos de proveedor cifrados
El sistema SHALL guardar los tokens y claves de proveedor de cada clínica (`metaWaAccessToken`, `smsApiKey`) **cifrados** en la base de datos (AES-256-GCM, clave `CONFIG_ENCRYPTION_KEY`) y MUST NOT devolverlos nunca en ninguna respuesta de la API (solo un indicador de presencia).

#### Scenario: Guardar un token
- **WHEN** un administrador pega el token de Meta en Configuración y guarda
- **THEN** la base de datos almacena el valor cifrado y la API responde `hasMetaWaToken: true` sin el valor

#### Scenario: Migración de valores en claro
- **WHEN** existen tokens guardados en claro antes de este cambio
- **THEN** el script de migración los cifra una sola vez y los deja en el formato cifrado

### Requirement: Consentimiento, baja y rebotes en todos los canales
El sistema SHALL respetar `acceptsEmail / acceptsWhatsapp / acceptsSms` en todo envío, SHALL incluir un **enlace de baja** en las comunicaciones comerciales (campañas) y SHALL procesar bajas (enlace, respuesta "STOP"/"BAJA" por WhatsApp) y **rebotes duros** de email, dejando traza en la ficha del paciente. Los mensajes de **servicio** solicitados por el propio paciente (enlace de acceso al portal) MAY enviarse sin consentimiento de marketing pero MUST respetar los rebotes.

#### Scenario: Baja por enlace
- **WHEN** un paciente pulsa "Darme de baja" en un email de campaña
- **THEN** `acceptsEmail` pasa a `false`, se registra `baja_email` y no recibe más campañas por email

#### Scenario: STOP por WhatsApp
- **WHEN** un paciente responde "STOP" al número de la clínica
- **THEN** el webhook marca `acceptsWhatsapp = false` y registra el evento

#### Scenario: Rebote duro
- **WHEN** Resend notifica un rebote permanente del email de un paciente
- **THEN** se sella `emailBouncedAt` y los envíos posteriores por email se omiten con motivo "email no válido"

### Requirement: Enlaces de mensaje de larga duración y cortos
Todo enlace que viaje en un mensaje al paciente (reserva, confirmación, recuperación, renovación) SHALL usar un token de **30 días** y un **enlace corto** `/b/CODE`. El enlace de acceso al portal SHALL mantener su sesión de 60 minutos pero MAY viajar como enlace corto.

#### Scenario: Renovación abierta días después
- **WHEN** un paciente abre el WhatsApp de renovación 5 días después de recibirlo
- **THEN** el enlace sigue siendo válido y abre la página de reserva

### Requirement: Campañas con cola, throttling y cron propio
El envío de campañas SHALL realizarse de forma **asíncrona** mediante una cola persistente (`MessageDelivery`) procesada por lotes con pausa por proveedor y reintentos, y las campañas programadas SHALL evaluarse al menos cada **10 minutos**. Los contadores de la campaña MUST reflejar únicamente el resultado real de la cola.

#### Scenario: Campaña grande
- **WHEN** se envía una campaña de email a 500 pacientes
- **THEN** la petición responde al instante con estado `SENDING`, los envíos se procesan en lotes sin superar el límite del proveedor y los contadores se actualizan al terminar

#### Scenario: Programada a las 17:00
- **WHEN** una campaña está programada para las 17:00
- **THEN** empieza a enviarse como máximo 10 minutos después, no al día siguiente

### Requirement: Plantillas aprobadas para WhatsApp
Para WhatsApp, el sistema SHALL enviar exclusivamente **plantillas aprobadas por Meta** referenciadas por nombre e idioma, con un mapeo explícito de variables del CRM a los parámetros de la plantilla, y MUST NOT permitir texto libre iniciado por la clínica en campañas ni avisos.

#### Scenario: Campaña WhatsApp
- **WHEN** un administrador crea una campaña por WhatsApp
- **THEN** elige una plantilla aprobada y el sistema rellena sus variables por paciente; no existe campo de texto libre

### Requirement: Trazabilidad de entregas por paciente
El sistema SHALL registrar cada envío en `MessageDelivery` (canal, proveedor, evento o campaña, estado `PENDING/SENT/DELIVERED/READ/FAILED/SKIPPED/BOUNCED`, error, identificador externo) y SHALL mostrarlo en la ficha del paciente junto a su historial.

#### Scenario: Ver qué recibió un paciente
- **WHEN** recepción abre la ficha de un paciente
- **THEN** ve la lista de comunicaciones con canal, estado y fecha, incluidas las omitidas con su motivo

### Requirement: Webhooks de proveedor verificados e idempotentes
El sistema SHALL exponer webhooks públicos para Meta (verificación por `verify token` y firma `X-Hub-Signature-256`) y Resend (firma), MUST rechazar peticiones sin firma válida y MUST ser idempotente por identificador de mensaje del proveedor.

#### Scenario: Estado de entrega duplicado
- **WHEN** Meta reenvía el mismo evento `delivered` dos veces
- **THEN** el estado se aplica una sola vez sin error

### Requirement: Avisos transaccionales automáticos con selección de canal
El sistema SHALL ofrecer un servicio único `notify(evento)` que, para cada evento del ciclo de la cita (`appointment_created`, `appointment_reminder`, `confirmation_requested`, `noshow_invite`, `renewal_reminder`, `portal_access`), elige el canal según una prioridad configurable, el consentimiento, los rebotes y los canales disponibles de la clínica, y encola el envío con la plantilla transaccional de la clínica (o la del sistema por defecto).

#### Scenario: Cita creada por recepción
- **WHEN** recepción crea una cita a un paciente con WhatsApp consentido y configurado
- **THEN** el paciente recibe la confirmación por WhatsApp con el enlace para confirmar o avisar que no podrá ir

#### Scenario: Sin canal posible
- **WHEN** el paciente no ha consentido ningún canal y no tiene email
- **THEN** no se envía nada, queda una entrega `SKIPPED` con motivo y recepción puede usar los botones manuales

#### Scenario: Invitación automática tras no-show
- **WHEN** una cita pasa a `NO_SHOW` y la clínica tiene activada la invitación automática
- **THEN** se envía la invitación a reagendar y la fila de la bandeja "Recuperar" aparece como "Contactada (auto)"

### Requirement: Plantillas de avisos editables por clínica
El sistema SHALL distinguir `MessageTemplate.kind` (`CAMPAIGN` | `TRANSACTIONAL`) y SHALL permitir a los administradores editar en **Configuración → Plantillas de avisos** el texto de cada evento por canal con sus variables, usando el motor `renderTemplate` común y con plantillas del sistema como valor por defecto.

#### Scenario: Personalizar la confirmación
- **WHEN** un administrador edita la plantilla de email de "cita creada" y guarda
- **THEN** los siguientes avisos de ese evento por email usan el texto nuevo; WhatsApp sigue usando su plantilla aprobada

## MODIFIED Requirements

### Requirement: Acceso al portal del paciente por cualquier canal disponible
El enlace de acceso al portal SHALL enviarse por email y, si la ficha no tiene email pero sí móvil, por SMS o WhatsApp cuando estén configurados. El modo provisional de **revelar el enlace en pantalla** SHALL aplicarse solo cuando la clínica no tenga **ningún** canal configurado, y MUST desactivarse automáticamente en cuanto exista uno.

#### Scenario: Paciente sin email
- **WHEN** un paciente sin email en su ficha solicita acceso y la clínica tiene SMS configurado
- **THEN** recibe el enlace corto por SMS y la pantalla muestra el mensaje genérico

#### Scenario: Email configurado
- **WHEN** la clínica tiene email configurado
- **THEN** la pantalla de solicitud de acceso no muestra nunca el enlace

### Requirement: Workflow de renovación con consentimiento y traza
El workflow automático de renovación SHALL comprobar el consentimiento y el medio de contacto antes de enviar, SHALL usar el enlace corto de 30 días, SHALL dejar `MessageDelivery` y `CustomerEvent`, y SHALL usar las credenciales de WhatsApp de la clínica de la regla.

#### Scenario: Paciente sin consentimiento de WhatsApp
- **WHEN** el workflow encuentra una revisión próxima a caducar de un paciente con `acceptsWhatsapp = false`
- **THEN** la ejecución queda `SKIPPED` con motivo y no se envía nada por WhatsApp (si hay otro canal consentido, `notify` lo usa)
