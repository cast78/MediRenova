## ADDED Requirements

### Requirement: Embudo de conversión de reservas a visitas
El sistema SHALL calcular, para un rango de fechas y filtros dados, el embudo de conversión con las etapas reservas → confirmadas → atendidas → visitas completadas, junto con el desglose de fugas (canceladas, reprogramadas, no-show y "se fue") y sus tasas. Las cancelaciones con motivo `DUPLICADA` o `ERROR` MUST excluirse del cálculo de tasas por considerarse ruido.

#### Scenario: Cálculo del embudo en un periodo
- **WHEN** un admin solicita el embudo para un rango de fechas
- **THEN** el sistema devuelve el recuento de reservas, confirmadas, atendidas y visitas completadas del periodo y la tasa de conversión entre cada etapa

#### Scenario: Desglose de cancelaciones por motivo
- **WHEN** el periodo contiene cancelaciones con motivo `CLIENTE` y `CENTRO`
- **THEN** el sistema devuelve ambas cifras por separado (oportunidad de recaptura vs problema operativo) y no incluye en las tasas las canceladas con motivo `DUPLICADA` o `ERROR`

#### Scenario: Reprogramaciones contadas una sola vez
- **WHEN** una cita se reprograma (la original queda `RESCHEDULED` y se crea una nueva)
- **THEN** el sistema cuenta la reprogramación una única vez (la cita original) y no la duplica al contar la cita nueva

#### Scenario: Visitas que se fueron sin ser atendidas
- **WHEN** existen visitas con estado `LEFT` en el periodo
- **THEN** el sistema las reporta como fuga "se fue" separada de las canceladas y de los no-show

### Requirement: Ocupación de sala frente a disponibilidad
El sistema SHALL calcular la ocupación de cada sala como minutos-slot usados dividido entre minutos-slot disponibles, donde la disponibilidad se deriva del horario semanal de la sala y los festivos del centro. Las salas inactivas MUST excluirse.

#### Scenario: Ocupación de una sala en un periodo
- **WHEN** se solicita la ocupación de una sala con horario definido para un rango de fechas
- **THEN** el sistema devuelve el porcentaje de ocupación = minutos usados por citas no canceladas / minutos disponibles del horario menos festivos

#### Scenario: Días no laborables excluidos
- **WHEN** el periodo incluye días fuera del horario semanal de la sala o festivos del centro
- **THEN** esos minutos no computan como disponibilidad y no penalizan la ocupación

#### Scenario: Sala inactiva
- **WHEN** una sala está marcada como inactiva
- **THEN** no aparece en el informe de ocupación

### Requirement: Saturación temporal de la demanda
El sistema SHALL producir una serie temporal (por día, semana o mes según la granularidad pedida) que compare la demanda de reservas con la capacidad disponible, e identifique los buckets saturados según un umbral configurable.

#### Scenario: Serie de saturación por día
- **WHEN** se solicita la saturación con granularidad diaria para un periodo
- **THEN** el sistema devuelve, por día, la demanda, la capacidad y el ratio de saturación

#### Scenario: Identificación de días saturados
- **WHEN** un día supera el umbral de saturación (por defecto 90 %)
- **THEN** ese día se marca como saturado en la respuesta

### Requirement: Rendimiento por médico
El sistema SHALL calcular, por médico y periodo, las visitas atendidas, el número de pacientes distintos, la tasa de aptitud (`APTO / (APTO + NO_APTO)`) y el tiempo medio en sala.

#### Scenario: Métricas de un médico
- **WHEN** se solicita el rendimiento de los médicos para un periodo
- **THEN** el sistema devuelve por médico las visitas atendidas, los pacientes distintos, la tasa de aptitud y el tiempo medio en sala

#### Scenario: Médico sin actividad en el periodo
- **WHEN** un médico no tiene revisiones completadas en el periodo
- **THEN** aparece con contadores en cero y tasa de aptitud nula (no se divide por cero)

### Requirement: Comparativa entre salas y entre centros
El sistema SHALL permitir comparar las mismas métricas (volumen, ocupación, conversión) entre las salas de un centro y entre los distintos centros del alcance del solicitante.

#### Scenario: Comparativa de salas dentro de un centro
- **WHEN** un admin solicita la comparativa de salas de uno de sus centros
- **THEN** el sistema devuelve una fila por sala con sus métricas para el periodo

#### Scenario: Comparativa entre centros
- **WHEN** el solicitante tiene varios centros en su alcance
- **THEN** el sistema devuelve una fila por centro con sus métricas agregadas

### Requirement: Series temporales de volumen
El sistema SHALL devolver series de volumen de visitas y de reservas agregadas por mes o por año para el periodo solicitado.

#### Scenario: Volumen mensual
- **WHEN** se solicita el volumen con granularidad mensual
- **THEN** el sistema devuelve una entrada por mes con el número de visitas y de reservas

### Requirement: Alcance por rol y aislamiento entre tenants
El sistema SHALL restringir el alcance de la analítica según el rol: un ADMIN sólo ve datos de su propio tenant (y de sus centros asignados por defecto), mientras que un SUPERADMIN puede consultar datos cross-tenant únicamente cuando lo solicita de forma explícita. Los datos de distintos tenants MUST NOT mezclarse sin petición explícita del superadmin.

#### Scenario: Admin acotado a su tenant
- **WHEN** un ADMIN solicita cualquier informe
- **THEN** el sistema devuelve exclusivamente datos de su tenant

#### Scenario: Superadmin con rollup de plataforma
- **WHEN** un SUPERADMIN solicita un informe con alcance `scope=all`
- **THEN** el sistema agrega datos de todos los tenants y ofrece el desglose por tenant

#### Scenario: Superadmin acotado a un tenant
- **WHEN** un SUPERADMIN solicita un informe indicando un `tenantId` concreto
- **THEN** el sistema devuelve sólo los datos de ese tenant

#### Scenario: Rol sin permiso
- **WHEN** un usuario con rol DOCTOR o RECEPTIONIST solicita un endpoint de analítica
- **THEN** el sistema responde con error de autorización

### Requirement: Filtros comunes de análisis
El sistema SHALL aceptar en todos los endpoints de analítica un conjunto común de filtros: rango de fechas obligatorio (`from`, `to`) y filtros opcionales por centro, sala, médico y producto. Un rango que exceda el máximo permitido MUST rechazarse.

#### Scenario: Filtrado combinado
- **WHEN** se solicita un informe con centro, médico y producto concretos
- **THEN** el sistema aplica todos los filtros de forma conjunta

#### Scenario: Rango de fechas inválido
- **WHEN** se solicita un informe sin rango de fechas o con un rango que excede el máximo permitido
- **THEN** el sistema rechaza la petición con un error de validación

### Requirement: Exportación de informes a CSV
El sistema SHALL permitir exportar el resultado de cualquier vista de analítica en formato CSV aplicando los mismos filtros que la vista en pantalla.

#### Scenario: Exportar una vista
- **WHEN** se solicita un informe con `format=csv`
- **THEN** el sistema devuelve un CSV con las mismas filas y filtros que la respuesta en pantalla

### Requirement: API de analítica documentada y como fuente única de KPIs
El sistema SHALL exponer los KPIs a través de una API de solo lectura con contrato estable y documentado (OpenAPI/Swagger), de modo que todos los consumidores (dashboard interno, exportación e integraciones externas) obtengan los mismos valores desde el mismo endpoint. La lógica de cálculo de cada métrica MUST residir en el backend y NO duplicarse en los clientes.

#### Scenario: Contrato documentado
- **WHEN** se publican los endpoints de analítica
- **THEN** cada uno aparece documentado en `/docs` con sus parámetros de filtro y su esquema de respuesta

#### Scenario: Valores consistentes entre consumidores
- **WHEN** el dashboard interno y una exportación consultan el mismo KPI con los mismos filtros
- **THEN** ambos obtienen exactamente los mismos valores calculados por el backend

### Requirement: Exposición externa opcional por API Key
El sistema SHALL poder servir los mismos KPIs a través de la API pública autenticada por API Key, respetando el aislamiento por tenant de la API Key. El acceso externo MUST poder habilitarse o deshabilitarse sin cambiar la lógica de cálculo.

#### Scenario: Consumo externo con API Key válida
- **WHEN** una integración externa solicita un KPI con una API Key válida de un tenant
- **THEN** el sistema devuelve los datos de ese tenant y sólo de ese tenant

#### Scenario: API Key sin permiso o inválida
- **WHEN** se solicita un KPI con una API Key inválida o sin permiso de analítica
- **THEN** el sistema rechaza la petición con un error de autorización
