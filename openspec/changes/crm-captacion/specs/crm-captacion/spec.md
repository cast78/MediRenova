## ADDED Requirements

### Requirement: Altas de clientes por periodo y canal
El sistema SHALL calcular, para un rango de fechas y filtros dados, el número de clientes dados de alta (`Customer.createdAt`) agregado por la granularidad pedida, con desglose por canal de captación derivado del `source` de la primera cita del cliente.

#### Scenario: Serie de altas mensual
- **WHEN** un admin solicita las altas con granularidad mensual para un periodo
- **THEN** el sistema devuelve, por mes, el número de clientes nuevos dados de alta en ese mes

#### Scenario: Desglose por canal
- **WHEN** se solicitan las altas del periodo
- **THEN** el sistema devuelve el reparto por canal (BACKOFFICE, MAGIC_LINK, API, WALK_IN) según el origen de la primera cita, y agrupa como "sin cita" a los clientes sin ninguna cita

### Requirement: Clientes nuevos frente a recurrentes
El sistema SHALL distinguir, en el periodo, los clientes nuevos (cuya primera cita cae dentro del rango) de los recurrentes (con actividad anterior al rango).

#### Scenario: Reparto nuevo vs recurrente
- **WHEN** un admin solicita la captación de un periodo
- **THEN** el sistema devuelve cuántos clientes atendidos son nuevos y cuántos recurrentes

### Requirement: Efectividad de campañas por atribución de ventana
El sistema SHALL calcular, por campaña con `sentAt`, cuántos destinatarios convirtieron, donde un destinatario cuenta como convertido si su cliente creó una cita dentro de una ventana de N días tras el envío. El sistema SHALL devolver por campaña: enviados, convertidos, tasa de conversión y reservas y visitas atribuidas.

#### Scenario: Conversión dentro de la ventana
- **WHEN** un destinatario recibió una campaña y su cliente creó una cita 5 días después, con ventana de 30 días
- **THEN** ese destinatario se cuenta como convertido para esa campaña

#### Scenario: Sin conversión fuera de la ventana
- **WHEN** el cliente de un destinatario creó una cita 40 días después del envío, con ventana de 30 días
- **THEN** ese destinatario NO se cuenta como convertido

#### Scenario: Métricas por campaña
- **WHEN** se solicita la efectividad de las campañas del periodo
- **THEN** cada campaña muestra enviados, convertidos, tasa de conversión, reservas atribuidas y visitas atribuidas

### Requirement: Ventana de atribución configurable y sin doble conteo
El sistema SHALL permitir configurar la ventana de atribución (por defecto 30 días) y, cuando una cita cae en la ventana de varias campañas, SHALL atribuirla a la campaña más reciente enviada antes de la cita (last-touch), sin contar la conversión más de una vez.

#### Scenario: Ventana personalizada
- **WHEN** se solicita la efectividad con una ventana de 15 días
- **THEN** solo se atribuyen conversiones cuya cita cae dentro de 15 días tras el envío

#### Scenario: Desambiguación last-touch
- **WHEN** un cliente recibió dos campañas y creó una cita dentro de la ventana de ambas
- **THEN** la conversión se atribuye únicamente a la campaña más reciente enviada antes de la cita

### Requirement: API documentada y alcance por rol
El sistema SHALL exponer la captación y la efectividad de campañas como endpoints de solo lectura documentados (OpenAPI), con los mismos filtros comunes y reglas de alcance por rol que la analítica: ADMIN acotado a su tenant y SUPERADMIN cross-tenant solo si lo pide explícitamente. Los roles sin permiso MUST recibir un error de autorización.

#### Scenario: Admin acotado a su tenant
- **WHEN** un ADMIN solicita la captación o la efectividad de campañas
- **THEN** el sistema devuelve solo datos de su tenant

#### Scenario: Rol sin permiso
- **WHEN** un usuario DOCTOR o RECEPTIONIST solicita un endpoint de captación
- **THEN** el sistema responde con error de autorización

#### Scenario: Exportación CSV
- **WHEN** se solicita la efectividad de campañas con `format=csv`
- **THEN** el sistema devuelve un CSV con las mismas filas y filtros

### Requirement: Visualización de captación que consume solo la API
El sistema SHALL ofrecer en el módulo de analítica una vista de Captación (altas por periodo/canal, nuevos vs recurrentes y tabla de efectividad de campañas) que obtiene todos sus datos exclusivamente de la API de captación.

#### Scenario: Vista de captación
- **WHEN** un admin abre la vista de Captación
- **THEN** ve las altas del periodo con su canal y la tabla de efectividad por campaña, sin cálculo de métricas en el cliente

### Requirement: Atribución almacenada (fase 2, posterior al freeze)
El sistema SHALL, en una fase posterior, persistir la conversión de cada destinatario (`CampaignRecipient.convertedAt`) mediante un hook al crear la cita, para una atribución precisa e independiente de recomputar la ventana. Esta fase requiere migración y NO se aplica durante el periodo de demos.

#### Scenario: Marcado de conversión al reservar
- **WHEN** (fase 2) un cliente que recibió una campaña dentro de la ventana crea una cita
- **THEN** el sistema marca `convertedAt` en el destinatario correspondiente (last-touch) y la API de efectividad usa ese valor persistido
