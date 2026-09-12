## Why

Cuando un paciente **llega** (se crea una `Visit`) pero el episodio **nunca se cierra** —el médico no registra el diagnóstico, o el paciente se va en plena revisión— la cita queda en un limbo: no es un no-show (vino), no es una visita completada (sin diagnóstico) y no se puede cancelar (ya está iniciada). Hoy esos casos:

- Se cuelan en la worklist de reservas **"Sin cerrar"**, donde recepción **no puede resolverlos** (Gestionar no cancela ni marca no-show una reserva ya presentada, y recepción no produce diagnósticos).
- El **barrido automático** de la regla de reserva única los **excluye a propósito** (tienen visita → no son no-show), así que **quedan indefinidamente** sin cierre y sin dueño.

Esto es una **señal de calidad y cumplimiento**, no higiene de agenda: un reconocimiento médico es un acto regulado; un episodio abierto sin desenlace significa que el proceso se rompió (posible certificado no emitido, dato incompleto, KPI distorsionado). Debe ser **visible para recepción y admin**, con un **cierre que registre el motivo real** —nunca fabricando un desenlace clínico—.

## What Changes

- **Nuevo panel "Episodios sin cerrar"** (visible para RECEPTIONIST, DOCTOR y ADMIN), **separado** de la worklist de reservas "Sin cerrar" (que queda solo para no-show/cancelar de citas **sin** visita).
- **Detección**: citas de días pasados cuyo episodio (`Visit`/`Revision`) no alcanzó un estado terminal (visita `WAITING`/`IN_PROGRESS` o revisión a medias). Cada fila muestra el **estado atascado** (esperó sin ser atendido / en sala sin revisión / revisión a medias), el **médico responsable** y la **antigüedad**.
- **Cierre por rol, registrando el motivo** (taxonomía de 4):
  1. **"Se fue"** (recepción/médico): el paciente se marchó → `Visit LEFT`. Fuga "se fue".
  2. **"Completada tarde"** (médico): completa la revisión con diagnóstico → `ATTENDED` + flag automático "cerrada fuera de plazo".
  3. **"Anulada (llegada errónea)"** (recepción/admin): check-in erróneo/duplicado → se descarta la visita; la cita vuelve a su vía normal. Excluida de KPIs (ruido).
  4. **"Cierre administrativo sin diagnóstico"** (solo ADMIN): último recurso para huérfanas irrecuperables y limpieza inicial de datos demo → estado terminal propio, auditado, en un **bucket "sin resolver"**.
- **Trazabilidad**: los cierres administrativos y las anulaciones **no contaminan** los KPIs clínicos (aptitud, no-show, embudo), pero **siempre son visibles**: auditados 1 a 1 (quién/cuándo/nota) y contados en su métrica propia.
- **Aviso de fin de día** (prevención): notifica los episodios abiertos del día al médico/recepción/admin para cerrarlos el mismo día.

## Capabilities

### New Capabilities

- `crm-episodios-sin-cerrar`: Panel compartido (recepción/médico/admin) de episodios sin cerrar (paciente llegó pero el episodio no alcanzó desenlace), con cierre por rol que registra el motivo real (se fue / completada tarde / anulada / cierre administrativo), trazabilidad aislada de los KPIs clínicos y aviso de fin de día.

### Modified Capabilities

- `revisions`: se añade la marca **"cerrada fuera de plazo"** (`closedLate`) al completar una revisión después del día de la cita, para medir el descuido sin alterar el desenlace clínico.
- `appointments`: se añade el estado/atributo de **cierre administrativo** y de **anulación por error** para resolver episodios que no encajan en los desenlaces normales, y se ajusta la worklist "Sin cerrar" para excluir citas con visita (van al panel nuevo).

## Impact

- **Modelos → migración**: campo de cierre administrativo + motivo/auditoría en la cita (o un registro de auditoría dedicado), flag `closedLate` en `Revision`, y —si se decide— un estado terminal para "se fue" a nivel de cita (o se deriva de `Visit LEFT`). Se define en `design.md`.
- **Backend**: endpoint de listado del panel (con estado atascado + antigüedad + responsable), endpoints de cada acción de cierre con control por rol, y cron de aviso de fin de día.
- **Frontend**: nuevo panel "Episodios sin cerrar"; y ajuste de la worklist "Sin cerrar" de reservas para dejarla solo para no-show/cancelar (citas sin visita).
- **Analítica**: nuevo bucket "sin resolver" (cierres administrativos) y métrica de "cerradas fuera de plazo"; ambos aislados de las tasas clínicas.
- **Fases**: se implementa por fases (ver `tasks.md`): primero visibilidad + cierres de recepción/admin + auditoría; luego flag de completada-tarde, métricas y avisos.
