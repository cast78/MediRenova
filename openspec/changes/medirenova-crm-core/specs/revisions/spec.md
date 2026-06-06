## ADDED Requirements

### Requirement: Ciclo de vida de la revisión médica
El sistema SHALL permitir al médico crear, rellenar y completar una revisión vinculada a un appointment. Una revisión MUST tener los estados: `IN_PROGRESS`, `COMPLETED`. Solo un médico con acceso a la sala puede completar la revisión.

#### Scenario: Apertura de revisión
- **WHEN** un médico abre un appointment con estado `CONFIRMED`
- **THEN** el sistema crea una revisión en estado `IN_PROGRESS` y carga el formulario activo del producto

#### Scenario: Revisión sin appointment confirmado
- **WHEN** un médico intenta crear una revisión para un appointment en estado `CANCELLED`
- **THEN** el sistema devuelve error `APPOINTMENT_NOT_CONFIRMED`

### Requirement: Formulario dinámico en revisión
El sistema SHALL renderizar en el frontend el formulario JSON Schema del producto activo. El médico MUST poder guardar el progreso parcialmente (draft) sin completar la revisión. Los datos del formulario MUST almacenarse en `form_data` (JSONB).

#### Scenario: Guardado parcial de revisión
- **WHEN** el médico guarda el formulario sin completarlo
- **THEN** `form_data` se actualiza con los campos rellenos y la revisión permanece en `IN_PROGRESS`

### Requirement: Adjunto de fotos en revisión
El sistema SHALL permitir adjuntar fotos (imágenes JPEG/PNG, PDFs) a los campos de tipo `photo` del formulario. Las fotos MUST subirse a Cloudflare R2 y referenciarse por URL en `form_data`.

#### Scenario: Subida de foto de espirometría
- **WHEN** el médico adjunta una imagen de espirometría al campo correspondiente
- **THEN** la imagen se sube a R2 y la URL se almacena en `form_data.{field_id}`

### Requirement: Resultado de la revisión (outcome)
Al completar una revisión, el sistema SHALL determinar el outcome (`APTO`, `NO_APTO`) basándose en el campo configurado como `outcome_field` en el schema del formulario. El médico MUST confirmar el outcome antes de finalizar.

#### Scenario: Revisión completada como APTO
- **WHEN** el médico completa la revisión con resultado positivo
- **THEN** el outcome se guarda como `APTO`, se calcula la `expiry_date` según las reglas del producto y la edad del cliente, y se genera el PDF

#### Scenario: Revisión completada como NO_APTO
- **WHEN** el médico completa la revisión con resultado negativo
- **THEN** el outcome se guarda como `NO_APTO` y NO se calcula `expiry_date`

### Requirement: Generación de PDF al completar revisión
El sistema SHALL generar síncronamente el certificado PDF al completar la revisión. El PDF MUST usar la plantilla HTML/Handlebars del producto, populada con los datos del formulario y los datos del cliente. El PDF resultante MUST subirse a Cloudflare R2.

#### Scenario: PDF generado correctamente
- **WHEN** se completa una revisión con outcome `APTO`
- **THEN** el sistema genera el PDF, lo sube a R2, y devuelve en la respuesta la `pdf_url`

#### Scenario: Descarga de PDF de revisión previa
- **WHEN** un médico o admin solicita `GET /revisions/{id}/pdf`
- **THEN** el sistema devuelve una URL firmada de R2 con expiración de 1 hora
