## ADDED Requirements

### Requirement: Gestión de centros médicos
El sistema SHALL permitir crear, leer, actualizar y desactivar centros médicos. Un centro MUST pertenecer a un único tenant. Los campos obligatorios son: nombre, dirección, ciudad, provincia, código postal.

#### Scenario: Creación de centro
- **WHEN** un admin crea un centro con todos los campos obligatorios
- **THEN** el sistema crea el centro con `active: true` por defecto

#### Scenario: Desactivación de centro con reservas futuras
- **WHEN** un admin intenta desactivar un centro que tiene reservas confirmadas futuras
- **THEN** el sistema devuelve un error `CONFLICT` indicando el número de reservas afectadas y requiere confirmación explícita

### Requirement: Identificación fiscal del centro
Cada centro MAY almacenar un identificador fiscal opcional (CIF, NIF o NIE español). Si se proporciona, el sistema MUST validar su formato y normalizarlo a mayúsculas. No se exige validar el dígito de control.

#### Scenario: CIF válido normalizado
- **WHEN** un admin guarda un centro con CIF `b12345674`
- **THEN** el sistema lo almacena normalizado como `B12345674`

#### Scenario: CIF con formato inválido
- **WHEN** un admin intenta guardar un centro con un CIF que no cumple el formato CIF/NIF/NIE
- **THEN** el sistema devuelve un error de validación `400` indicando el campo `cif`

### Requirement: Datos de contacto del centro
Cada centro MAY tener múltiples teléfonos y múltiples emails de contacto, almacenados como listas independientes. Cada email MUST tener formato válido. Ambas listas pueden estar vacías.

#### Scenario: Centro con varios teléfonos y emails
- **WHEN** un admin guarda un centro con dos teléfonos y dos emails
- **THEN** el sistema almacena ambas listas completas y las devuelve al consultar el centro

#### Scenario: Email inválido en la lista
- **WHEN** un admin intenta guardar un centro con un email mal formado en la lista de emails
- **THEN** el sistema devuelve un error de validación `400` indicando el campo `emails`

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
