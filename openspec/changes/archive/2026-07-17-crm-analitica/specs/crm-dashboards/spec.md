## ADDED Requirements

### Requirement: Módulo de visualización que consume solo la API de analítica
El sistema SHALL ofrecer un módulo de dashboards para ADMIN y SUPERADMIN que obtiene todos sus datos exclusivamente de la API de analítica. El frontend MUST NOT calcular métricas por su cuenta ni acceder a la base de datos directamente.

#### Scenario: El dashboard se alimenta de la API
- **WHEN** un admin abre el módulo de analítica
- **THEN** cada panel se rellena con la respuesta de un endpoint de la API de analítica, sin lógica de cálculo en el cliente

#### Scenario: Acceso restringido por rol
- **WHEN** un usuario con rol DOCTOR o RECEPTIONIST intenta acceder al módulo de analítica
- **THEN** el módulo no está disponible para ese usuario

### Requirement: Dashboard resumen orientado a decisión
El sistema SHALL presentar una vista de inicio con las tarjetas de KPIs clave (conversión, ocupación, saturación, no-show, aptitud) y las alertas activas, desde la que se pueda navegar a cada vista detallada.

#### Scenario: Vista de inicio con KPIs y navegación
- **WHEN** un admin entra en la sección de analítica
- **THEN** ve las tarjetas de KPIs clave del periodo seleccionado y cada tarjeta enlaza a su vista detallada

### Requirement: Alertas por umbral que señalan dónde actuar
El sistema SHALL resaltar visualmente las situaciones que requieren acción de gestión según umbrales: días saturados, tasa de conversión por debajo de objetivo y no-show por encima de umbral.

#### Scenario: Resaltado de un problema
- **WHEN** en el periodo hay días saturados o la conversión cae por debajo del objetivo
- **THEN** el dashboard muestra una alerta destacada indicando la métrica y el ámbito afectado (centro/sala/médico)

### Requirement: Comparación entre periodos
El sistema SHALL permitir comparar el periodo seleccionado con un periodo de referencia (p. ej. el anterior) y mostrar la variación de cada KPI.

#### Scenario: Comparar con el periodo anterior
- **WHEN** un admin activa la comparación con el periodo anterior
- **THEN** cada KPI muestra su valor actual y la variación respecto al periodo de referencia

### Requirement: Drill-down por ámbito
El sistema SHALL permitir profundizar desde un nivel agregado hacia un nivel más específico (centro → sala → médico) reutilizando los filtros comunes.

#### Scenario: Profundizar de centro a sala
- **WHEN** un admin selecciona un centro en una vista de comparativa
- **THEN** el dashboard aplica ese centro como filtro y muestra el desglose por sala

### Requirement: Alcance de visualización por rol
El sistema SHALL adaptar la visualización al rol: un ADMIN ve el dashboard de su tenant (y sus centros), mientras que un SUPERADMIN dispone de un selector de alcance (plataforma o tenant concreto) y de una comparativa entre centros/tenants.

#### Scenario: Superadmin cambia de alcance
- **WHEN** un SUPERADMIN cambia el selector de alcance a "plataforma"
- **THEN** el dashboard muestra el rollup de todos los tenants con desglose por tenant

### Requirement: Exportar o compartir la vista
El sistema SHALL permitir exportar los datos de la vista actual (CSV) conservando los filtros aplicados.

#### Scenario: Exportar la vista actual
- **WHEN** un admin pulsa "Exportar" en una vista con filtros aplicados
- **THEN** se descarga un CSV con esos mismos filtros, generado por la API de analítica
