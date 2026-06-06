## ADDED Requirements

### Requirement: Gestión de datos personales de clientes
El sistema SHALL permitir crear y gestionar clientes con los siguientes campos: nombre, apellidos, DNI (encriptado AES-256-GCM), fecha de nacimiento, nacionalidad, municipio, provincia, teléfono, email. El DNI MUST ser único dentro del tenant.

#### Scenario: DNI duplicado en el mismo tenant
- **WHEN** se intenta crear un cliente con un DNI que ya existe en el tenant
- **THEN** el sistema devuelve error `DNI_ALREADY_EXISTS` y sugiere buscar el cliente existente

#### Scenario: Validación de letra de control del DNI
- **WHEN** se crea o actualiza un cliente con DNI "12345678Z" (letra incorrecta)
- **THEN** el sistema devuelve error `INVALID_DNI_CHECKSUM`

### Requirement: Consentimiento GDPR
El sistema MUST registrar el consentimiento GDPR del cliente en el momento de creación. Los campos `gdpr_consent_at` (timestamp) y `gdpr_consent_ip` (IP del solicitante) son OBLIGATORIOS para crear un cliente.

#### Scenario: Creación sin consentimiento GDPR
- **WHEN** se intenta crear un cliente sin enviar `gdpr_consent: true`
- **THEN** el sistema devuelve error `GDPR_CONSENT_REQUIRED`

### Requirement: Historial de revisiones del cliente
El sistema SHALL exponer el historial completo de revisiones de un cliente, ordenado por fecha descendente, incluyendo: producto, outcome, fecha, médico y enlace al PDF.

#### Scenario: Historial de cliente con múltiples revisiones
- **WHEN** se consulta `GET /customers/{id}/revisions`
- **THEN** se devuelven todas las revisiones del cliente para ese tenant, ordenadas de más reciente a más antigua

### Requirement: Soft delete y derecho al olvido
El sistema SHALL implementar borrado lógico (soft delete) para clientes. Al borrar, los campos PII (nombre, apellidos, DNI, email, teléfono) MUST ponerse a null y el campo `deleted_at` MUST registrar la fecha. Las revisiones asociadas se conservan para auditoría con datos anonimizados.

#### Scenario: Borrado de cliente
- **WHEN** un admin ejecuta `DELETE /customers/{id}`
- **THEN** el cliente queda con `deleted_at` timestamp y todos los campos PII a null

#### Scenario: Cliente borrado no aparece en búsquedas
- **WHEN** se realiza una búsqueda de clientes
- **THEN** los clientes con `deleted_at` no nulo no aparecen en los resultados

### Requirement: Búsqueda de clientes
El sistema SHALL permitir buscar clientes por nombre, apellidos, DNI (búsqueda exacta tras encriptado) o teléfono/email (búsqueda parcial). La búsqueda MUST estar paginada.

#### Scenario: Búsqueda por nombre parcial
- **WHEN** se busca "García" en clientes
- **THEN** se devuelven todos los clientes cuyo nombre o apellidos contienen "García" (case-insensitive)
