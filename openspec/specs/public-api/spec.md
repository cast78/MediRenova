## ADDED Requirements

### Requirement: Autenticación por API Key
El sistema SHALL autenticar requests a la API pública mediante el header `X-API-Key`. Cada API Key MUST pertenecer a un tenant. El sistema MUST verificar el hash SHA-256 de la key recibida contra el almacenado en BD. Las requests sin API Key válida MUST ser rechazadas con `401 Unauthorized`.

#### Scenario: Request con API Key válida
- **WHEN** una integración envía `X-API-Key: sk_live_xxx` con una key activa
- **THEN** el sistema procesa la request en el contexto del tenant de esa key

#### Scenario: API Key revocada
- **WHEN** una integración envía una API Key que ha sido revocada
- **THEN** el sistema devuelve `401 Unauthorized` con código `API_KEY_REVOKED`

### Requirement: Rate limiting por API Key
El sistema SHALL aplicar rate limiting de 1.000 requests por hora por API Key. Al superar el límite, el sistema MUST devolver `429 Too Many Requests` con el header `Retry-After` indicando segundos hasta el reset.

#### Scenario: Rate limit alcanzado
- **WHEN** una API Key realiza la petición 1.001 en la misma hora
- **THEN** el sistema devuelve `429 Too Many Requests` con header `Retry-After`

### Requirement: Consulta de disponibilidad pública
El sistema SHALL exponer `GET /public/v1/centers/{id}/availability` para consultar slots disponibles dado un `product_id` y `date`. El endpoint MUST devolver los mismos datos que el endpoint interno de disponibilidad.

#### Scenario: Disponibilidad consultada por API
- **WHEN** una integración consulta disponibilidad para el producto X el día Y
- **THEN** se devuelven los slots libres en formato `{ slots: [{ time, room_id, room_name }] }`

### Requirement: Creación de clientes y reservas por API
El sistema SHALL exponer `POST /public/v1/customers` y `POST /public/v1/appointments` para que integraciones externas creen clientes y reservas. Las mismas validaciones del backoffice MUST aplicarse.

#### Scenario: Creación de reserva por API con slot ocupado
- **WHEN** una integración intenta crear una reserva en un slot ya ocupado
- **THEN** el sistema devuelve `409 Conflict` con error `SLOT_UNAVAILABLE`

### Requirement: Consulta de productos y centros por API
El sistema SHALL exponer `GET /public/v1/products` y `GET /public/v1/centers` para que integraciones puedan obtener el catálogo del tenant. Los productos inactivos MUST excluirse de la respuesta.

#### Scenario: Lista de productos activos
- **WHEN** una integración consulta `GET /public/v1/products`
- **THEN** se devuelven únicamente los productos con `active: true` del tenant de la API Key

### Requirement: Formato de respuesta envelope
Todos los endpoints de la API pública SHALL devolver respuestas en el formato envelope: `{ "data": {...}, "meta": { "page": N, "total": N }, "errors": null }`. Los errores MUST usar `{ "data": null, "errors": [{ "code": "...", "message": "..." }] }`.

#### Scenario: Error de validación con envelope
- **WHEN** una integración envía datos inválidos
- **THEN** la respuesta tiene `data: null` y `errors` con código y mensaje descriptivo en español
