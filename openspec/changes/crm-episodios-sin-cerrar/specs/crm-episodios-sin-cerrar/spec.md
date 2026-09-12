## ADDED Requirements

### Requirement: Panel de episodios sin cerrar visible para recepción, médico y admin
El sistema SHALL ofrecer un panel "Episodios sin cerrar" que liste las citas cuyo día ya pasó y cuyo episodio no alcanzó desenlace (el paciente llegó pero no se cerró). El panel MUST ser visible para los roles `RECEPTIONIST`, `DOCTOR` y `ADMIN`, con el aislamiento por tenant/centro habitual.

#### Scenario: Recepción y admin ven los episodios abiertos
- **WHEN** una recepcionista o un admin abre el panel "Episodios sin cerrar"
- **THEN** ve las citas pasadas con visita/revisión sin terminar, cada una con su estado atascado, el médico responsable y la antigüedad

#### Scenario: Un rol sin permiso no accede
- **WHEN** un usuario sin rol de personal (p. ej. API Key) solicita el panel
- **THEN** el sistema devuelve un error de autorización

### Requirement: Detección y clasificación del estado atascado
El sistema SHALL considerar "episodio sin cerrar" una cita de un día pasado con una `Visit` en estado no terminal (`WAITING` o `IN_PROGRESS`) o con una `Revision` iniciada sin completar. El sistema MUST clasificar el estado en: "esperó sin ser atendido", "en sala sin revisión" o "revisión a medias".

#### Scenario: Visita en espera de un día pasado
- **WHEN** una cita de ayer tiene una visita en `WAITING` y ninguna revisión
- **THEN** aparece en el panel con estado "esperó sin ser atendido"

#### Scenario: Revisión a medias
- **WHEN** una cita pasada tiene una revisión iniciada sin `completedAt`
- **THEN** aparece con estado "revisión a medias"

#### Scenario: Cita sin visita no es un episodio
- **WHEN** una cita pasada está en `PENDING`/`CONFIRMED` pero no tiene visita
- **THEN** NO aparece en este panel (es candidata a no-show/cancelar en la worklist de reservas)

### Requirement: Separación de la worklist de reservas
El sistema SHALL mostrar en la worklist de reservas "Sin cerrar" únicamente citas pasadas **sin visita** (candidatas a no-show o cancelación). Las citas con visita MUST NOT aparecer allí; van al panel de episodios sin cerrar.

#### Scenario: La worklist de reservas excluye las citas con visita
- **WHEN** una cita pasada tiene una visita en curso
- **THEN** no aparece en la worklist de reservas "Sin cerrar" (aparece en "Episodios sin cerrar")

### Requirement: Cierre "Se fue"
El sistema SHALL permitir a recepción o al médico cerrar un episodio como "se fue" cuando el paciente se marchó sin completar la atención. La visita MUST pasar a `LEFT` y el episodio MUST quedar resuelto (sale del panel). Este cierre MUST contarse como la fuga "se fue" del embudo, no como no-show ni como visita completada.

#### Scenario: El paciente se marchó en plena espera
- **WHEN** una recepcionista marca "Se fue" en un episodio con visita `WAITING`
- **THEN** la visita pasa a `LEFT`, el episodio sale del panel y se contabiliza como fuga "se fue"

### Requirement: Cierre por revisión completada tarde
El sistema SHALL permitir al médico cerrar el episodio completando la revisión con su diagnóstico. Si la revisión se completa **después del día de la cita**, el sistema MUST marcarla como "cerrada fuera de plazo" (`closedLate`) sin alterar el desenlace clínico.

#### Scenario: El médico completa una revisión atrasada
- **WHEN** un médico completa una revisión de una cita de días atrás con outcome `APTO`
- **THEN** la cita pasa a `ATTENDED`, cuenta como visita completada y en la tasa de aptitud, y la revisión queda marcada como "cerrada fuera de plazo"

### Requirement: Anulación por llegada errónea
El sistema SHALL permitir a recepción o admin **anular** un episodio cuando el check-in fue un error (paciente equivocado, duplicado o dato de prueba). La visita MUST descartarse y la cita MUST volver a su vía normal (poder marcarse no-show/cancelar/reprogramar). Las anulaciones MUST excluirse de los KPIs clínicos como ruido.

#### Scenario: Check-in duplicado anulado
- **WHEN** una recepcionista anula un episodio marcado como llegada errónea
- **THEN** la visita se descarta, la cita queda "sin visita" y la anulación no computa en embudo/aptitud/no-show

### Requirement: Cierre administrativo sin diagnóstico
El sistema SHALL permitir **solo a un ADMIN** cerrar administrativamente un episodio irrecuperable (huérfano sin información, o limpieza inicial de datos demo) sin registrar un desenlace clínico. El cierre MUST llevar a un estado terminal propio, MUST registrar auditoría (actor, fecha, nota) y MUST NOT contarse como visita completada, no-show ni "se fue".

#### Scenario: Admin cierra un episodio huérfano muy antiguo
- **WHEN** un admin ejecuta el cierre administrativo de una cita antigua sin poder reconstruir qué pasó
- **THEN** el episodio queda cerrado en el bucket "sin resolver", con una entrada de auditoría y su nota, y sin afectar las tasas clínicas

#### Scenario: Recepción no puede hacer cierre administrativo
- **WHEN** una recepcionista intenta el cierre administrativo de un episodio
- **THEN** el sistema devuelve un error de autorización (solo ADMIN)

### Requirement: Trazabilidad y aislamiento en KPIs
El sistema SHALL mantener las anulaciones y los cierres administrativos **aislados** de las tasas clínicas (aptitud, no-show, conversión del embudo) y a la vez **visibles**: cada uno MUST ser auditable por caso y MUST sumar a una métrica propia (episodios "sin resolver" / "cerradas fuera de plazo").

#### Scenario: Los cierres administrativos no ensucian el KPI pero se ven
- **WHEN** un admin consulta la analítica tras varios cierres administrativos
- **THEN** las tasas clínicas no incluyen esos casos, y a la vez existe una métrica que muestra cuántos episodios se cerraron sin resolver, cuándo y por quién

### Requirement: Aviso de fin de día de episodios abiertos
El sistema SHALL enviar, al final del día, un aviso con los episodios sin cerrar al médico, recepción y/o admin correspondientes, para fomentar su cierre el mismo día.

#### Scenario: Recordatorio al cierre de la jornada
- **WHEN** finaliza el día y quedan episodios abiertos de ese día
- **THEN** el sistema notifica a los responsables la lista de episodios pendientes de cerrar
