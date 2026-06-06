## ADDED Requirements

### Requirement: Catálogo de productos por tenant
El sistema SHALL permitir a cada tenant gestionar su propio catálogo de productos. Un producto MUST incluir: nombre, tipo de documento (`CARNET_CONDUCIR`, `LICENCIA_ARMAS`, `DNI`, `OTRO`), duración del slot en minutos, estado activo/inactivo.

#### Scenario: Producto inactivo excluido de reservas
- **WHEN** se intenta crear una reserva con un producto marcado como inactivo
- **THEN** el sistema devuelve error `PRODUCT_INACTIVE`

### Requirement: Reglas de renovación por edad
Cada producto SHALL tener una lista de reglas de renovación que determinan la vigencia del certificado según la edad del paciente en el momento de la revisión. Las reglas MUST cubrir todos los rangos de edad sin solapamientos ni huecos.

Reglas por defecto para Carnet de Conducir (normativa DGT vigente):
- Categorías A, B, B+E: 0–64 años → 10 años | 65–70 años → 5 años | +70 años → 2 años
- Categorías C, C+E, D, D+E: 0–44 años → 5 años | 45–64 años → 3 años | +65 años → 1 año

#### Scenario: Cálculo de vigencia para conductor de 68 años (carnet B)
- **WHEN** se completa una revisión de carnet tipo B para un cliente de 68 años
- **THEN** la `expiry_date` se calcula como `revision_date + 5 años`

#### Scenario: Reglas sin cobertura de edad
- **WHEN** un admin guarda un producto con reglas que no cubren el rango 0–120 años completo
- **THEN** el sistema devuelve error de validación indicando los huecos de cobertura

### Requirement: Plantilla PDF por producto
Cada producto SHALL tener asociada una plantilla HTML/Handlebars para la generación del certificado PDF. La plantilla MUST usar variables con la sintaxis `{{variable_name}}` mapeadas a campos del formulario.

#### Scenario: Generación de PDF con plantilla del producto
- **WHEN** se completa una revisión de "Carnet B"
- **THEN** el PDF generado usa la plantilla configurada para "Carnet B" y no la de otro producto

### Requirement: Formulario base por producto
Cada producto SHALL tener asociado un formulario base (`form_template`) que define los campos del reconocimiento médico. Un producto sin formulario activo no MUST permitir iniciar revisiones.

#### Scenario: Revisión sin formulario activo
- **WHEN** un médico intenta abrir una revisión de un producto sin formulario activo
- **THEN** el sistema devuelve error `NO_ACTIVE_FORM_TEMPLATE`
