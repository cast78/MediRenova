## ADDED Requirements

### Requirement: Gestión de centros médicos
El sistema SHALL permitir crear, leer, actualizar y desactivar centros médicos. Un centro MUST pertenecer a un único tenant. Los campos obligatorios son: nombre, dirección, ciudad, provincia, código postal.

#### Scenario: Creación de centro
- **WHEN** un admin crea un centro con todos los campos obligatorios
- **THEN** el sistema crea el centro con `active: true` por defecto

#### Scenario: Desactivación de centro con reservas futuras
- **WHEN** un admin intenta desactivar un centro que tiene reservas confirmadas futuras
- **THEN** el sistema devuelve un error `CONFLICT` indicando el número de reservas afectadas y requiere confirmación explícita

### Requirement: Geolocalización de centros
Cada centro SHALL almacenar coordenadas `lat`/`lng` opcionales. Si se proporciona dirección completa, el sistema SHOULD intentar geocodificar automáticamente.

#### Scenario: Centro con coordenadas
- **WHEN** el magic link muestra centros disponibles a un cliente
- **THEN** los centros se muestran ordenados por distancia si el cliente ha compartido su ubicación

### Requirement: Gestión de salas
Cada centro SHALL tener una o más salas. Una sala MUST pertenecer a un único centro. Los campos obligatorios son: nombre. Una sala puede estar activa o inactiva.

#### Scenario: Sala inactiva excluida de disponibilidad
- **WHEN** se consulta disponibilidad de slots para un centro
- **THEN** las salas con `active: false` no aparecen en los resultados

### Requirement: Horarios semanales de salas
Cada sala SHALL tener un horario semanal configurable por día de semana. Cada franja horaria incluye: día de semana (0–6), hora de inicio, hora de fin. Una sala puede tener múltiples franjas por día.

#### Scenario: Sala sin horario el domingo
- **WHEN** se consulta disponibilidad para un domingo en una sala sin franja para ese día
- **THEN** el sistema devuelve cero slots para esa sala ese día

#### Scenario: Sala con dos franjas el lunes
- **WHEN** una sala tiene franja 09:00–13:00 y 16:00–19:00 el lunes
- **THEN** el motor de disponibilidad genera slots en ambas franjas

### Requirement: Festivos por centro
Cada centro SHALL poder configurar una lista de fechas de festivo. En fechas de festivo, ninguna sala del centro tendrá slots disponibles.

#### Scenario: Día festivo sin disponibilidad
- **WHEN** se consulta disponibilidad para una fecha marcada como festivo en el centro
- **THEN** el sistema devuelve cero slots y el motivo `HOLIDAY`

### Requirement: Tipos de productos permitidos por sala
Cada sala SHALL declarar qué tipos de productos puede atender. Una reserva MUST validar que el producto solicitado está permitido en la sala seleccionada.

#### Scenario: Producto no permitido en sala
- **WHEN** se intenta crear una reserva de "Carnet B" en una sala que solo permite "Licencia de armas"
- **THEN** el sistema devuelve error `PRODUCT_NOT_ALLOWED_IN_ROOM`
