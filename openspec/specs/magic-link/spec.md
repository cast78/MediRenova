## ADDED Requirements

### Requirement: Token JWT de magic link
El sistema SHALL generar tokens JWT firmados con los claims: `cid` (customer_id), `pid` (product_id), `tid` (tenant_id), `type: 'magic_link'`, `exp` (24 horas desde emisión). El token MUST firmarse con la misma clave RS256 del sistema.

#### Scenario: Token válido
- **WHEN** un cliente abre una URL con magic link cuyo token no ha expirado
- **THEN** el sistema devuelve el contexto: producto preseleccionado, centros disponibles y slots

#### Scenario: Token expirado
- **WHEN** un cliente abre una URL con magic link cuyo token tiene más de 24 horas
- **THEN** el sistema devuelve error `MAGIC_LINK_EXPIRED` con mensaje informativo al cliente

#### Scenario: Token de otro tenant
- **WHEN** un token contiene `tid` de un tenant diferente al del subdominio donde se abre
- **THEN** el sistema devuelve `403 Forbidden`

### Requirement: Flujo de confirmación sin login
El cliente SHALL poder confirmar una reserva usando únicamente el token del magic link, sin necesidad de crear cuenta ni hacer login. El cliente MUST seleccionar centro y slot antes de confirmar.

#### Scenario: Confirmación exitosa
- **WHEN** el cliente selecciona un slot disponible y confirma
- **THEN** se crea la reserva con `source: MAGIC_LINK`, estado `CONFIRMED`, y se devuelve el archivo `.ics`

### Requirement: Reprogramación mediante magic link
El cliente SHALL poder reprogramar su reserva existente usando el mismo magic link, mientras el token sea válido. Si el cliente ya tiene una reserva `CONFIRMED` para el mismo producto, la reprogramación MUST cancelar la anterior y crear una nueva.

#### Scenario: Reprogramación de cita existente
- **WHEN** el cliente usa el magic link para seleccionar un slot diferente
- **THEN** la reserva anterior pasa a `RESCHEDULED` y se crea una nueva reserva `CONFIRMED`

### Requirement: Vista de disponibilidad en magic link
El sistema SHALL mostrar al cliente los centros del tenant ordenados por proximidad (si hay coordenadas) y los slots disponibles para el producto del token. El cliente MUST ver al menos 7 días de disponibilidad futura.

#### Scenario: Sin disponibilidad en 7 días
- **WHEN** no hay slots disponibles en los próximos 7 días
- **THEN** el sistema amplía automáticamente la búsqueda hasta 30 días y lo indica al cliente
