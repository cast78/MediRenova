## ADDED Requirements

### Requirement: Acceso al portal sin contraseña con verificación de identidad
El sistema SHALL permitir a un paciente acceder a su área privada **sin cuenta ni contraseña**, mediante un **enlace mágico** enviado al contacto que ya consta en su ficha, previa **verificación de identidad** (DNI + fecha de nacimiento). El enlace MUST enviarse únicamente al email/teléfono almacenado, nunca a un contacto aportado en la solicitud.

#### Scenario: Solicitud con identidad correcta
- **WHEN** un paciente introduce su DNI y fecha de nacimiento que coinciden con un cliente del centro
- **THEN** el sistema envía un enlace de acceso al email/SMS de su ficha y muestra un mensaje genérico de "te hemos enviado un enlace"

#### Scenario: Anti-enumeración
- **WHEN** los datos no coinciden con ningún cliente (o el cliente no tiene contacto)
- **THEN** el sistema responde con el **mismo** mensaje genérico y no revela si existe o no, ni envía nada

#### Scenario: Canje del enlace por una sesión
- **WHEN** el paciente abre el enlace recibido y este es válido y no ha caducado
- **THEN** el sistema le concede una **sesión de portal corta** acotada a su cliente y su centro

### Requirement: Ver y descargar los propios reconocimientos
El sistema SHALL mostrar al paciente autenticado la lista de **sus** revisiones completadas (producto, fecha, dictamen APTO/NO APTO y caducidad) y permitir **descargar el PDF** del certificado. La descarga MUST verificar que la revisión pertenece al paciente de la sesión antes de servir el archivo.

#### Scenario: Listado de mis reconocimientos
- **WHEN** un paciente con sesión de portal abre "Mis reconocimientos"
- **THEN** ve solo sus revisiones, cada una con producto, fecha, dictamen y (si APTO) fecha de caducidad

#### Scenario: Descarga del propio certificado
- **WHEN** el paciente pulsa "Descargar" en una revisión suya
- **THEN** el sistema genera/recupera el PDF y lo sirve

#### Scenario: No se puede descargar un certificado ajeno
- **WHEN** una sesión de portal solicita el PDF de una revisión cuyo `customerId` no es el suyo
- **THEN** el sistema responde con un error de autorización y no sirve el archivo

### Requirement: Ver el propio historial de citas
El sistema SHALL mostrar al paciente autenticado sus **citas** (próximas e historial), con fecha, centro y estado, filtradas por su `customerId`.

#### Scenario: Historial y próximas citas
- **WHEN** el paciente abre "Mis citas"
- **THEN** ve sus próximas citas y su historial pasado, sin datos de otros pacientes

### Requirement: Aislamiento estricto por cliente
El sistema SHALL garantizar que toda consulta del portal devuelve **solo** datos del paciente de la sesión: cada consulta MUST filtrar explícitamente por `customerId` (además del `tenantId`), sin depender de la RLS de base de datos (que hoy no se aplica en runtime).

#### Scenario: Una sesión no ve datos de otro cliente del mismo centro
- **WHEN** una sesión de portal consulta revisiones o citas
- **THEN** el resultado contiene únicamente registros cuyo `customerId` coincide con el de la sesión

### Requirement: Límite de solicitudes y trazabilidad de acceso
El sistema SHALL proteger la solicitud de acceso frente a abuso (rate-limit por IP y por identidad) y SHALL registrar en auditoría los accesos y descargas del portal.

#### Scenario: Rate-limit en la solicitud de enlace
- **WHEN** se superan los intentos permitidos de solicitud de acceso desde una IP o para un DNI
- **THEN** el sistema rechaza temporalmente nuevas solicitudes

#### Scenario: Registro de descarga
- **WHEN** un paciente descarga su certificado desde el portal
- **THEN** queda una entrada de auditoría (cliente, revisión, fecha) sin exponer el documento a terceros
