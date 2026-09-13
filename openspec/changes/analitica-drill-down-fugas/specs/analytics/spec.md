## ADDED Requirements

### Requirement: Detalle (drill-down) de las fugas del embudo
El sistema SHALL permitir, desde la tarjeta "Fugas del periodo" del embudo de conversión, **abrir el detalle** de cualquier recuento de fuga y ver la **lista de casos** (citas/clientes) que lo componen. La lista MUST respetar los filtros activos del informe (rango de fechas, centro, médico, producto) y MUST cuadrar exactamente con el número agregado (mismos criterios).

#### Scenario: Ver las citas detrás de un no-show
- **WHEN** un usuario pulsa el recuento "No-show" de las fugas del periodo
- **THEN** se abre un panel con la lista de las citas no-show del periodo/filtros, cada una con cliente (enlace a su ficha), fecha, producto y sala/centro, y su total coincide con el recuento

#### Scenario: El detalle respeta los filtros
- **WHEN** hay un centro o un médico seleccionado en el informe y se abre el detalle de una fuga
- **THEN** la lista solo incluye los casos de ese centro/médico

### Requirement: Detalle de los episodios aislados sin contaminar KPIs
El sistema SHALL ofrecer el mismo detalle para los episodios **aislados** —"sin resolver" (cierres administrativos) y "completadas fuera de plazo"—, mostrando su información propia (nota/actor del cierre administrativo; fecha de la revisión tardía). Estos casos MUST seguir **excluidos** de las tasas clínicas: el drill-down solo los **lista**, nunca los suma al embudo/aptitud/no-show.

#### Scenario: Ver los cierres administrativos
- **WHEN** un admin pulsa el recuento "Sin resolver"
- **THEN** ve la lista de episodios cerrados administrativamente con su nota, actor y fecha, y esos casos no aparecen en las tasas clínicas del embudo
