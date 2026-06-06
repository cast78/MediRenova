## ADDED Requirements

### Requirement: Reglas de workflow configurables por tenant
El sistema SHALL permitir a cada tenant configurar reglas de workflow comercial que definen: días antes de caducidad para enviar alerta, acción (WhatsApp), plantilla de mensaje, días entre reintentos y número máximo de reintentos.

#### Scenario: Regla de 90 días
- **WHEN** se configura una regla de workflow a 90 días con reintentos cada 15 días y máximo 3 intentos
- **THEN** el sistema envía el primer WhatsApp a los 90 días antes de caducidad y reintenta a los 75 y 60 días si no hay reserva

### Requirement: Detección diaria de caducidades
El sistema SHALL ejecutar un job cron diario que identifica todas las revisiones con `outcome: APTO` cuya `expiry_date` cae en el horizonte de las reglas activas y que no tienen ya una reserva futura activa para el mismo producto.

#### Scenario: Cliente con reserva ya hecha
- **WHEN** el cron identifica a un cliente con caducidad en 90 días pero ya tiene una reserva confirmada futura
- **THEN** no se envía ningún WhatsApp a ese cliente

#### Scenario: Cliente sin reserva próxima
- **WHEN** el cron identifica a un cliente con caducidad en 90 días y sin reservas futuras confirmadas
- **THEN** se genera un magic link y se registra una `workflow_execution` con estado `PENDING_SEND`

### Requirement: Envío de WhatsApp con magic link
El sistema SHALL enviar un mensaje WhatsApp al cliente vía Meta Cloud API incluyendo el magic link. La plantilla MUST estar aprobada por Meta. El sistema MUST registrar el resultado del envío en `workflow_executions`.

#### Scenario: Envío exitoso
- **WHEN** Meta Cloud API devuelve confirmación de entrega
- **THEN** `workflow_execution.status` pasa a `SENT` y `last_attempt_at` se registra

#### Scenario: Fallo de envío
- **WHEN** Meta Cloud API devuelve error
- **THEN** `workflow_execution.status` pasa a `FAILED` y se programa el reintento según `retry_every_days`

### Requirement: Gestión de reintentos
El sistema SHALL reintentar el envío según la configuración de la regla. Si se alcanza `max_retries`, la ejecución pasa a estado `EXHAUSTED` y se notifica al admin del tenant mediante dashboard.

#### Scenario: Reintentos agotados
- **WHEN** un workflow_execution alcanza `attempt_count >= max_retries`
- **THEN** el estado pasa a `EXHAUSTED` y aparece como alerta en el dashboard del admin

### Requirement: Detención del workflow al confirmar reserva
El sistema SHALL detener cualquier workflow_execution pendiente para un cliente+producto cuando se cree una reserva confirmada para ese cliente y producto.

#### Scenario: Cliente reserva tras recibir WhatsApp
- **WHEN** un cliente confirma una reserva para el producto X
- **THEN** todos los `workflow_executions` con estado `PENDING_SEND` o `SENT` para ese cliente y producto quedan en estado `COMPLETED`
