## ADDED Requirements

### Requirement: Bandeja de recuperación de no-shows visible para recepción y admin
El sistema SHALL ofrecer una pestaña "Recuperar" dentro de Reservas que liste las citas en estado `NO_SHOW` de una ventana reciente (por defecto **30 días**). La bandeja MUST ser visible para los roles `RECEPTIONIST` y `ADMIN`, con el aislamiento por tenant/centro habitual, y MUST NOT ser accesible por otros roles.

#### Scenario: Recepción ve los no-shows recientes
- **WHEN** una recepcionista o un admin abre la pestaña "Recuperar"
- **THEN** ve las citas `NO_SHOW` de los últimos 30 días, cada una con paciente, fecha de la cita perdida, producto, sala/centro y cómo se cerró (Auto o Manual)

#### Scenario: Un rol sin permiso no accede
- **WHEN** un usuario sin rol de recepción/admin solicita el listado de no-shows
- **THEN** el sistema devuelve un error de autorización

### Requirement: Distinción de no-show automático y manual
El sistema SHALL indicar en cada fila si el no-show fue marcado **automáticamente** por el barrido (`autoClosed = true`) o **manualmente** por recepción.

#### Scenario: No-show auto-cerrado
- **WHEN** el barrido marca `NO_SHOW` una cita de más de 2 días sin visita
- **THEN** esa fila aparece en la bandeja con la marca "Auto"

#### Scenario: No-show marcado a mano
- **WHEN** recepción marca "No presentó" en una cita pasada
- **THEN** esa fila aparece en la bandeja con la marca "Manual"

### Requirement: Estado de seguimiento por no-show
El sistema SHALL registrar el seguimiento de cada no-show como *Pendiente* (sin registro), *Contactado* o *Descartado*, en una tabla dedicada `NoShowRecovery`. El sistema MUST permitir marcar *Contactado*, *Descartado* y revertir a *Pendiente* (`reset`), guardando quién y cuándo, y MUST dejar traza en la ficha del cliente (`CustomerEvent`).

#### Scenario: Marcar contactado
- **WHEN** una recepcionista pulsa "Contactado" en un no-show pendiente
- **THEN** la fila pasa a estado "Contactada" con el sello de quién y cuándo, y sale del recuento de "sin gestionar"

#### Scenario: Descartar y revertir
- **WHEN** una recepcionista descarta un no-show y luego lo revierte
- **THEN** la fila pasa a "Descartada" y, tras el `reset`, vuelve a "Pendiente"

### Requirement: Recuperación derivada por cita nueva del mismo producto
El sistema SHALL considerar un no-show **Recuperado** cuando el cliente obtiene una **cita nueva del mismo producto** creada después del no-show y no cancelada. Este estado MUST tener prioridad sobre el seguimiento manual y MUST alimentar la **tasa de recuperación** de la bandeja.

#### Scenario: El cliente reserva de nuevo el mismo producto
- **WHEN** un cliente con un no-show de "Carnet A/B" obtiene después una cita nueva de "Carnet A/B"
- **THEN** ese no-show pasa a "Recuperada", sale de "Pendientes" y cuenta en la tasa de recuperación

#### Scenario: Cita nueva de otro producto no cuenta
- **WHEN** el cliente reserva un producto distinto al del no-show
- **THEN** el no-show NO se marca como recuperado

### Requirement: Invitar a reagendar con enlace de reserva y consentimiento
El sistema SHALL ofrecer, por fila, una acción "Invitar a reagendar" que genere un **enlace de reserva nueva** (`/link/generate` → `/booking/:token`) para el cliente y su producto, y componga un mensaje de recuperación por defecto. Los canales de envío (WhatsApp/Email) MUST habilitarse solo si el cliente los ha consentido (RGPD); Copiar enlace MUST estar siempre disponible.

#### Scenario: Envío por un canal consentido
- **WHEN** recepción abre "Invitar a reagendar" de un cliente que aceptó WhatsApp
- **THEN** el botón de WhatsApp está habilitado con el texto y el enlace de reserva pre-rellenados

#### Scenario: Canal no consentido deshabilitado
- **WHEN** el cliente no aceptó email
- **THEN** el botón de Email aparece deshabilitado, pero Copiar enlace sigue disponible

### Requirement: Reagendado manual desde la bandeja
El sistema SHALL permitir, por fila, un **reagendado manual** por parte de recepción que abra el **popup de gestión de la cita** (el mismo del calendario), desde el que se crea la cita nueva ("Reservar nueva cita →").

#### Scenario: Recepción abre la gestión de la cita
- **WHEN** una recepcionista pulsa "Reagendar" en un no-show
- **THEN** se abre el popup de esa cita, con la trazabilidad y la acción de reservar una cita nueva

### Requirement: Enlace de recuperación para trazabilidad
El sistema SHALL enlazar la cita nueva creada al reagendar un no-show con el no-show de origen (`recoveredFromId`), **sin** cambiar el estado `NO_SHOW`. El enlace MUST marcar el no-show como "Recuperada" de forma explícita (prioridad sobre la heurística) y MUST ser visible en la trazabilidad de la cita nueva. El enlace MUST ser distinto de la reprogramación (no mostrarse como "Reprogramada").

#### Scenario: La cita nueva enlaza y muestra el rastro
- **WHEN** recepción reagenda un no-show y se crea la cita nueva
- **THEN** el no-show pasa a "Recuperada" por el enlace, y la cita nueva muestra "Recuperada del no-show del {fecha}" navegable al origen

#### Scenario: Enlace inválido se ignora
- **WHEN** se intenta enlazar con una cita que no es un NO_SHOW del mismo cliente y producto
- **THEN** el enlace se ignora y la reserva se crea igualmente sin rastro de recuperación

### Requirement: Mensaje de invitación transparente y no culpabilizador
El mensaje por defecto de "Invitar a reagendar" SHALL nombrar la cita concreta (producto y fecha) y mencionar que quedó sin realizar y sin cancelar ("sigue pendiente"), con un tono cálido y orientado a solución, sin reproche.

#### Scenario: El texto menciona la cita y el estado
- **WHEN** recepción abre "Invitar a reagendar"
- **THEN** el mensaje incluye el producto y la fecha de la cita perdida y explica que, al no cancelarse, sigue pendiente de reservar de nuevo
