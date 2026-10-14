## ADDED Requirements

### Requirement: Sin desbordamiento horizontal de página
En cualquier anchura a partir de 768 px, ninguna página del panel de gestión SHALL desplazarse lateralmente como conjunto. Solo las tablas y el calendario MAY desplazarse lateralmente, cada uno dentro de su propio contenedor con indicación visual de que hay más contenido.

#### Scenario: Clientes en tablet vertical
- **WHEN** un usuario abre Clientes a 768 px de anchura
- **THEN** la página no se desplaza lateralmente, la columna de nombre permanece visible y el resto de columnas se desplaza dentro de la tabla o se oculta por prioridad

### Requirement: Dispositivos soportados declarados
Mientras no se implemente la disposición compacta (Fase B), el sistema SHALL declarar como soportadas las tablets de 11" o más en horizontal (≥ 1024 px CSS) y SHALL cumplir en ellas los requisitos de controles táctiles y de tablas legibles. Las tablets de 10–11" en vertical (768–1023 px) MAY usarse, sin garantía de disposición, hasta la Fase B.

#### Scenario: iPad Pro 13 en cualquier orientación
- **WHEN** un usuario abre cualquier página en un iPad Pro 13" (1376×1032 o 1032×1376)
- **THEN** ve la disposición de escritorio con controles de tamaño táctil y tablas con scroll propio

### Requirement: Navegación compacta en tablet (Fase B)
Por debajo de 1024 px el menú lateral SHALL mostrarse como raíl de iconos y SHALL ofrecer un cajón con el menú completo, el plan, el usuario y cerrar sesión. A partir de 1024 px el menú SHALL ser el actual. Todas las rutas y módulos MUST seguir accesibles en ambas disposiciones, incluidos los módulos bloqueados por plan con su candado.

#### Scenario: Navegar desde el raíl
- **WHEN** un usuario toca el icono de Revisiones en el raíl a 768 px
- **THEN** navega a Revisiones sin abrir el cajón y el icono queda marcado como activo

#### Scenario: Abrir el cajón
- **WHEN** un usuario toca el botón de menú de la cabecera
- **THEN** se muestra el cajón sobre el contenido con las etiquetas de los módulos, "Tu plan", el usuario y "Cerrar sesión", y se cierra al tocar fuera o al navegar

### Requirement: Controles de tamaño táctil
En dispositivos con puntero táctil (`pointer: coarse`) los botones, campos, pestañas, chips y filas pulsables SHALL tener una altura mínima de 44 px y los iconos de acción un área de 40×40 px. Los campos de texto SHALL usar un tamaño de fuente de al menos 16 px para evitar el zoom automático. Ninguna acción MUST depender únicamente del estado hover ni de un tooltip.

#### Scenario: Acciones por fila en táctil
- **WHEN** un usuario con pantalla táctil ve la lista de revisiones
- **THEN** las acciones por fila que en escritorio aparecen al pasar el ratón están visibles o accesibles mediante un menú por fila

### Requirement: Reservas usable en tablet (Fase B)
Por debajo de 1024 px la vista por defecto de Reservas SHALL ser Día (recordada por dispositivo), las pestañas de vistas SHALL desplazarse lateralmente sin recortarse, la vista Semana SHALL mantener legibles las citas con desplazamiento lateral por día, y crear o editar una cita SHALL hacerse en una hoja a pantalla completa con las acciones siempre visibles.

#### Scenario: Semana en tablet vertical
- **WHEN** un usuario abre la vista Semana a 768 px
- **THEN** ve el día actual centrado, puede desplazarse lateralmente día a día y las citas muestran hora y nombre legibles

### Requirement: Modales y formularios en tablet (Fase B)
Por debajo de 1024 px todo diálogo modal SHALL mostrarse como hoja a pantalla completa con cabecera y pie fijos, y los formularios de dos columnas SHALL pasar a una columna. A partir de 1024 px los diálogos SHALL mantener su presentación actual.

#### Scenario: Consulta en tablet
- **WHEN** un médico abre una revisión a 820 px
- **THEN** el formulario de consulta se muestra a una columna, la firma ocupa todo el ancho y los botones de guardar y cerrar permanecen visibles al pie

### Requirement: Escritorio sin cambios
Las adaptaciones SHALL activarse únicamente por debajo de 1024 px o bajo puntero táctil; a 1280 px o más con ratón la interfaz MUST ser visualmente idéntica a la anterior al cambio.

#### Scenario: Comparación en escritorio
- **WHEN** se comparan capturas de cada página a 1440 px antes y después del cambio
- **THEN** no hay diferencias visuales
