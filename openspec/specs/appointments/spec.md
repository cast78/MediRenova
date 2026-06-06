## ADDED Requirements

### Requirement: Creación de reservas desde múltiples canales
El sistema SHALL permitir crear reservas desde tres canales: backoffice (usuario autenticado), magic link (cliente sin login) y API pública (API Key). Cada reserva MUST registrar su `source` (`BACKOFFICE`, `MAGIC_LINK`, `API`, `WALK_IN`).

#### Scenario: Reserva desde backoffice
- **WHEN** una recepcionista crea una reserva seleccionando cliente, producto, sala y slot
- **THEN** la reserva se crea con estado `CONFIRMED` y `source: BACKOFFICE`

#### Scenario: Reserva desde API pública
- **WHEN** una integración externa crea una reserva vía `POST /public/v1/appointments`
- **THEN** la reserva se crea con estado `CONFIRMED` y `source: API`

### Requirement: Disponibilidad dinámica de slots
El sistema SHALL calcular la disponibilidad en tiempo real sin slots precreados. El cálculo MUST: obtener el horario semanal de la sala, generar slots según la duración del producto, restar appointments existentes en estado `CONFIRMED` o `PENDING`, y restar festivos del centro.

#### Scenario: Slot disponible
- **WHEN** se consulta disponibilidad para el lunes 2026-06-15 a las 10:00 en Sala 1
- **THEN** el slot aparece disponible si no hay appointment confirmado/pendiente en ese slot

#### Scenario: Slot ocupado
- **WHEN** ya existe una reserva `CONFIRMED` el lunes 2026-06-15 a las 10:00 en Sala 1
- **THEN** ese slot no aparece en la disponibilidad

### Requirement: Protección contra double-booking
El sistema MUST usar un índice único condicional en la tabla `appointments` sobre `(room_id, scheduled_at)` excluyendo estados `CANCELLED` y `NO_SHOW`. Si dos requests concurrentes intentan reservar el mismo slot, solo una MUST tener éxito.

#### Scenario: Doble reserva simultánea
- **WHEN** dos requests simultáneas intentan reservar el mismo slot
- **THEN** una retorna `201 Created` y la otra retorna `409 Conflict` con error `SLOT_UNAVAILABLE`

### Requirement: Ciclo de vida de la reserva
Una reserva SHALL tener los siguientes estados: `PENDING`, `CONFIRMED`, `CANCELLED`, `RESCHEDULED`, `NO_SHOW`. Las transiciones válidas son: `PENDING → CONFIRMED`, `CONFIRMED → CANCELLED`, `CONFIRMED → RESCHEDULED`, `CONFIRMED → NO_SHOW`.

#### Scenario: Cancelación de reserva confirmada
- **WHEN** una recepcionista cancela una reserva con estado `CONFIRMED`
- **THEN** el estado pasa a `CANCELLED` y el slot queda libre para nuevas reservas

#### Scenario: Marcar no-show
- **WHEN** un médico marca una reserva como no-show
- **THEN** el estado pasa a `NO_SHOW` y se registra el timestamp

### Requirement: Generación de evento de calendario (.ics)
Al confirmar una reserva, el sistema SHALL generar un archivo `.ics` compatible con iCalendar (RFC 5545) con los datos de la cita.

#### Scenario: Reserva confirmada genera .ics
- **WHEN** se confirma una reserva
- **THEN** el sistema devuelve en la respuesta la URL para descargar el archivo `.ics` de la cita
