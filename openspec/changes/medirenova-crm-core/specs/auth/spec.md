## ADDED Requirements

### Requirement: Autenticación con JWT
El sistema SHALL autenticar usuarios mediante JWT con access token (15 minutos) y refresh token (7 días). El access token MUST contener los claims: `sub` (user_id), `tid` (tenant_id), `role`, `iat`, `exp`. Los tokens MUST firmarse con RS256.

#### Scenario: Login exitoso
- **WHEN** un usuario envía credenciales válidas (email + password)
- **THEN** el sistema devuelve un access token JWT y un refresh token opaco

#### Scenario: Access token caducado
- **WHEN** un usuario realiza una request con un access token expirado
- **THEN** el sistema devuelve `401 Unauthorized` con código `TOKEN_EXPIRED`

#### Scenario: Refresh token válido
- **WHEN** un usuario envía un refresh token válido al endpoint de renovación
- **THEN** el sistema devuelve un nuevo access token y rota el refresh token

### Requirement: Control de acceso por roles
El sistema SHALL implementar cuatro roles con permisos diferenciados: `superadmin`, `admin`, `doctor`, `receptionist`. Cada endpoint MUST declarar qué roles tienen acceso.

#### Scenario: Médico intenta crear un centro
- **WHEN** un usuario con rol `doctor` intenta hacer `POST /centers`
- **THEN** el sistema devuelve `403 Forbidden`

#### Scenario: Recepcionista crea una reserva
- **WHEN** un usuario con rol `receptionist` hace `POST /appointments` con datos válidos
- **THEN** el sistema crea la reserva correctamente

#### Scenario: Superadmin accede a gestión de tenants
- **WHEN** un usuario con rol `superadmin` accede a `GET /admin/tenants`
- **THEN** el sistema devuelve la lista de todos los tenants

### Requirement: Hash seguro de contraseñas
El sistema MUST almacenar contraseñas usando bcrypt con factor de trabajo mínimo de 12. Las contraseñas en texto plano MUST nunca almacenarse ni loguearse.

#### Scenario: Registro de contraseña
- **WHEN** un admin crea un usuario con contraseña "MiContraseña123!"
- **THEN** la BD almacena únicamente el hash bcrypt, nunca la contraseña original

### Requirement: Auditoría de accesos
El sistema SHALL registrar en `audit_logs` todas las operaciones de creación, modificación y borrado de clientes, revisiones y cambios de configuración de tenant. Cada entrada MUST incluir: `user_id`, `tenant_id`, `action`, `resource_type`, `resource_id`, `ip_address`, `created_at`.

#### Scenario: Modificación de cliente auditada
- **WHEN** un recepcionista modifica el teléfono de un cliente
- **THEN** se registra una entrada en `audit_logs` con `action: 'UPDATE'`, `resource_type: 'customer'` y el `user_id` del recepcionista
