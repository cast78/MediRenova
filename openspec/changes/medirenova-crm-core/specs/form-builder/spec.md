## ADDED Requirements

### Requirement: Schema de formulario como JSON versionado
El sistema SHALL almacenar los formularios dinámicos como JSON Schema (JSONB en PostgreSQL). Cada versión es inmutable una vez activada. El schema MUST incluir: array de secciones, cada sección con array de campos, y configuración de mapeo a PDF.

Tipos de campo soportados: `text`, `number`, `photo`, `select`, `checkbox`, `signature`.

#### Scenario: Activación de nueva versión
- **WHEN** un admin activa la versión 3 de un formulario
- **THEN** la versión anterior queda marcada como `inactive` y todas las revisiones futuras usan la versión 3

#### Scenario: Inmutabilidad de versión activa
- **WHEN** un admin intenta editar directamente una versión de formulario que ya tiene revisiones asociadas
- **THEN** el sistema rechaza la operación con error `FORM_VERSION_IMMUTABLE`

### Requirement: Builder visual de formularios
El sistema SHALL proporcionar una interfaz de arrastrar y soltar para construir formularios. El admin MUST poder: añadir campos, reordenarlos, configurar propiedades de cada campo (label, required, opciones para select), y agruparlos en secciones.

#### Scenario: Añadir campo de foto
- **WHEN** un admin arrastra un campo de tipo `photo` al formulario
- **THEN** el campo aparece en la posición indicada con configuración por defecto (no requerido, todos los formatos de imagen)

#### Scenario: Guardar nueva versión desde builder
- **WHEN** un admin guarda cambios en el builder
- **THEN** el sistema crea una nueva versión del formulario con estado `draft` sin afectar la versión activa

### Requirement: Formulario base como punto de partida
El sistema SHALL permitir crear un nuevo formulario a partir de una plantilla base definida por el sistema (ej. "Reconocimiento básico"). El admin MUST poder elegir una base y luego modificarla.

#### Scenario: Crear formulario desde plantilla
- **WHEN** un admin selecciona "Plantilla reconocimiento conducir" como base
- **THEN** el builder se precarga con los campos estándar de ese tipo de reconocimiento

### Requirement: Validaciones de campo en el schema
El sistema SHALL soportar las siguientes validaciones en el schema: `required` (boolean), `min_length`/`max_length` (para text), `min`/`max` (para number), `accept` (tipos MIME para photo), `max_size_mb` (para photo), `options` (array de strings para select).

#### Scenario: Validación de campo requerido en revisión
- **WHEN** un médico intenta completar una revisión sin rellenar un campo marcado como `required: true`
- **THEN** el sistema devuelve error de validación indicando el campo faltante

### Requirement: Mapeo de campos a variables PDF
El schema MUST incluir un objeto `pdf_mapping` que relaciona `field_id` con el nombre de variable en la plantilla Handlebars del PDF.

#### Scenario: Variable no mapeada en PDF
- **WHEN** la plantilla PDF contiene `{{resultado_vision}}` pero no hay campo en el formulario mapeado a esa variable
- **THEN** la variable se renderiza como cadena vacía en el PDF (no produce error)
