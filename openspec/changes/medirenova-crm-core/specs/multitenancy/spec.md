## ADDED Requirements

### Requirement: Aislamiento lógico de datos por tenant
Cada tenant SHALL tener sus datos completamente aislados mediante `tenant_id` en todas las tablas. El sistema MUST garantizar que ninguna query pueda devolver datos de otro tenant. PostgreSQL Row Level Security SHALL activarse como segunda capa de defensa.

#### Scenario: Aislamiento entre tenants
- **WHEN** un usuario autenticado del tenant A realiza una consulta de clientes
- **THEN** el sistema devuelve únicamente los clientes cuyo `tenant_id` coincide con el del token JWT

#### Scenario: Intento de acceso cross-tenant
- **WHEN** un usuario intenta acceder a un recurso con un ID que pertenece a otro tenant
- **THEN** el sistema devuelve `404 Not Found` (no `403`, para no revelar existencia del recurso)

### Requirement: Branding por tenant
Cada tenant SHALL poder configurar su logo y paleta de colores. El frontend MUST aplicar el branding del tenant al cargar la aplicación.

#### Scenario: Carga de branding
- **WHEN** el frontend carga la aplicación para un tenant (identificado por subdominio o slug)
- **THEN** se aplican los colores primario/secundario y el logo del tenant en toda la UI

### Requirement: Configuración independiente por tenant
Cada tenant SHALL tener una configuración propia que incluya: zona horaria, duración por defecto de slots, número máximo de reservas por día, y configuración de WhatsApp.

#### Scenario: Configuración de slot duration
- **WHEN** un admin de tenant actualiza la duración por defecto de slots a 30 minutos
- **THEN** el motor de disponibilidad usa 30 minutos como duración para los productos que no tengan una duración explícita

### Requirement: API Keys por tenant
Cada tenant SHALL poder generar múltiples API Keys para la API pública. Cada API Key MUST estar asociada a un nombre descriptivo y una fecha de creación. El sistema MUST almacenar únicamente el hash SHA-256 de la key.

#### Scenario: Generación de API Key
- **WHEN** un admin de tenant crea una nueva API Key con nombre "Integración Web"
- **THEN** el sistema devuelve la key en texto plano solo en ese momento y almacena su hash

#### Scenario: Revocación de API Key
- **WHEN** un admin revoca una API Key
- **THEN** todas las requests autenticadas con esa key son rechazadas con `401 Unauthorized`
