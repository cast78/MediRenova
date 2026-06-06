## ADDED Requirements

### Requirement: Panel de KPIs principal
El sistema SHALL mostrar al admin del tenant un dashboard con los siguientes KPIs en tiempo real: número de reservas hoy, número de reservas esta semana, expedientes abiertos (revisiones en `IN_PROGRESS`), y tasa de conversión (revisiones `APTO` / total revisiones completadas en los últimos 30 días).

#### Scenario: Dashboard con datos del día
- **WHEN** un admin accede al dashboard
- **THEN** ve el número de reservas confirmadas para hoy en todos sus centros

### Requirement: Panel de caducidades próximas
El sistema SHALL mostrar las caducidades de revisiones `APTO` en horizontes de 30, 60 y 90 días, agrupadas por producto. Cada entrada MUST mostrar: cliente, producto, fecha de caducidad y si ya tiene reserva futura.

#### Scenario: Caducidades a 30 días
- **WHEN** un admin consulta el panel de caducidades
- **THEN** ve la lista de clientes con `expiry_date` entre hoy y hoy+30 días, con indicador de si tienen reserva pendiente

### Requirement: Gráfico de reservas por mes
El sistema SHALL mostrar un gráfico de barras con el número de reservas confirmadas por mes, para los últimos 12 meses.

#### Scenario: Gráfico mensual
- **WHEN** el admin visualiza el dashboard
- **THEN** el gráfico muestra 12 barras, una por mes, con el conteo de reservas confirmadas

### Requirement: Mapa de clientes por provincia
El sistema SHALL mostrar una visualización con el conteo de clientes por provincia española.

#### Scenario: Distribución geográfica
- **WHEN** el admin consulta el dashboard
- **THEN** ve el número de clientes agrupados por la provincia de su municipio

### Requirement: Acceso al dashboard por rol
El dashboard principal SHALL estar accesible para roles `admin` y `superadmin`. Los recepcionistas MUST ver solo las reservas del día. Los médicos NO MUST tener acceso al dashboard.

#### Scenario: Médico sin acceso a dashboard
- **WHEN** un usuario con rol `doctor` intenta acceder al dashboard
- **THEN** el sistema devuelve `403 Forbidden`
