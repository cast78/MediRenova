## ADDED Requirements

### Requirement: Plan por empresa con catálogo de funciones
El sistema SHALL asignar a cada empresa un plan (`ESSENTIAL` | `PRO`) y SHALL derivar de un catálogo único las funciones disponibles. El plan **efectivo** SHALL ser `PRO` mientras exista una prueba vigente (`trialUntil` futura). Las excepciones por función (`featureOverrides`) MAY añadir o quitar funciones concretas, y el sistema MUST cerrar las dependencias declaradas en el catálogo. Las empresas existentes MUST quedar en `PRO` al desplegar este cambio.

#### Scenario: Empresa en Esencial
- **WHEN** una empresa tiene `plan = ESSENTIAL` y ninguna prueba vigente
- **THEN** dispone de agenda, visitas, consulta, revisiones, clientes, portal de certificados, KPIs operativos y botones manuales de contacto, y no dispone de campañas, workflow, recuperación, avisos automáticos, analítica avanzada, captación, reserva pública, API ni canales

#### Scenario: Prueba Pro vigente
- **WHEN** una empresa Esencial tiene `trialUntil` en el futuro
- **THEN** su plan efectivo es Pro y dispone de todas las funciones hasta esa fecha

#### Scenario: Excepción por función
- **WHEN** el proveedor añade `portal_full` a una empresa Esencial
- **THEN** la empresa dispone del portal completo y de su dependencia (`portal_certificates`) sin cambiar de plan

### Requirement: Guardia de funciones en la API
Toda ruta de un módulo Pro SHALL comprobar la función con `requireFeature` y responder `403 FEATURE_NOT_IN_PLAN` (con la función y el plan) cuando la empresa no la tenga. Las rutas públicas (reserva pública, enlace mágico, portal) MUST resolver la empresa a partir del token o la clave y aplicar la misma comprobación. El superadmin actuando como una empresa MUST NOT quedar exento.

#### Scenario: Llamada a campañas desde Esencial
- **WHEN** un admin de una empresa Esencial llama a `POST /campaigns`
- **THEN** recibe `403 FEATURE_NOT_IN_PLAN` con `feature: "campaigns"`

#### Scenario: Reserva pública sin plan
- **WHEN** se llama a `POST /public/v1/appointments` con la clave de API de una empresa Esencial
- **THEN** la petición se rechaza con `403 FEATURE_NOT_IN_PLAN`

### Requirement: Los procesos automáticos respetan el plan
Los crons de workflow de renovación y de campañas programadas SHALL omitir las empresas sin la función correspondiente, y `notify` SHALL no registrar avisos para empresas sin `messaging`, manteniendo disponibles los enlaces para los botones manuales.

#### Scenario: Cita creada en Esencial
- **WHEN** recepción de una empresa Esencial crea una cita
- **THEN** no se genera ningún aviso en Comunicaciones y el botón manual "Pedir confirmación" sigue generando su enlace

### Requirement: Menú y módulos bloqueados visibles
El sistema SHALL mostrar los módulos no incluidos en el plan con un indicador de candado en el menú y una página de módulo bloqueado que explica el beneficio y permite **solicitar el cambio a Pro**. El sistema MUST NOT ocultar silenciosamente los módulos.

#### Scenario: Abrir Campañas desde Esencial
- **WHEN** un admin Esencial pulsa "Campañas"
- **THEN** ve la página bloqueada con los beneficios y el botón "Quiero pasar a Pro"; al pulsarlo se registra una petición y recibe confirmación

### Requirement: Tarjeta "Tu plan"
El sistema SHALL mostrar al Admin de la clínica, en Configuración, su plan, la prueba vigente si existe, los centros contratados y el límite, qué incluye y qué no, el historial de cambios y la petición de cambio. El Admin MUST NOT poder cambiar el plan por sí mismo.

#### Scenario: Admin consulta su plan
- **WHEN** un admin abre Configuración → Empresa
- **THEN** ve "Plan Esencial · 2 centros" (o "Prueba Pro hasta 30/11/2026") y lo que incluye cada plan, sin control para cambiarlo

### Requirement: Panel de proveedor para gestionar empresas y licencias
El sistema SHALL ofrecer al rol `SUPERADMIN` un panel con la lista de empresas (plan, prueba, centros, usuarios, peticiones abiertas, estado), la ficha de cada empresa (cambiar plan y prueba, excepciones por función con validación de dependencias, límite de centros, activar/suspender), el alta de empresa con admin inicial, la bandeja de peticiones de upgrade y el acceso "Entrar como esta empresa". Todo cambio de plan MUST quedar auditado (quién, cuándo, de qué a qué).

#### Scenario: Pasar una empresa a Pro
- **WHEN** el superadmin cambia el plan de una empresa de Esencial a Pro desde su ficha
- **THEN** la empresa dispone de las funciones Pro de inmediato, sin pérdida ni migración de datos, y queda un registro de auditoría del cambio

#### Scenario: Alta de empresa
- **WHEN** el superadmin da de alta una empresa con su admin inicial
- **THEN** la empresa existe con el plan elegido (y prueba si se indicó) y el admin puede iniciar sesión

### Requirement: Pruebas con vencimiento automático
El sistema SHALL avisar al Admin de la clínica y al proveedor 7 días y 1 día antes del fin de una prueba, y al vencer SHALL volver automáticamente al plan contratado sin borrar datos, dejando auditoría del vencimiento.

#### Scenario: Fin de prueba
- **WHEN** `trialUntil` queda en el pasado para una empresa Esencial
- **THEN** los módulos Pro pasan a bloqueados, sus datos (campañas, avisos, reglas) se conservan y aparecen de nuevo si la empresa pasa a Pro

### Requirement: Centros como eje de contratación
El sistema SHALL permitir varios centros en cualquier plan y, cuando `maxCenters` esté definido, MUST rechazar la creación de un centro adicional con `409 MAX_CENTERS_REACHED`.

#### Scenario: Límite alcanzado
- **WHEN** una empresa con `maxCenters = 2` y 2 centros activos intenta crear un tercero
- **THEN** la API responde `409 MAX_CENTERS_REACHED` y la interfaz indica que debe contratar un centro más

## MODIFIED Requirements

### Requirement: Portal del paciente dividido por plan
El portal SHALL ofrecer el acceso y la descarga de certificados en cualquier plan (`portal_certificates`) y SHALL reservar las citas y la renovación desde el portal al plan Pro (`portal_full`).

#### Scenario: Paciente de una clínica Esencial
- **WHEN** un paciente entra en Mi área de una clínica Esencial
- **THEN** ve y descarga sus certificados y no ve la sección de citas ni enlaces de renovación

### Requirement: Credencial del superadmin fuera del código
La contraseña del usuario superadmin del seed SHALL leerse de la variable `SUPERADMIN_PASSWORD`, con un valor de desarrollo solo cuando no esté definida.

#### Scenario: Despliegue en producción
- **WHEN** el seed se ejecuta con `SUPERADMIN_PASSWORD` definida
- **THEN** el superadmin queda con esa contraseña y no con la del código
