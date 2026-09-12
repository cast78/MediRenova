# Design — crm-episodios-sin-cerrar

## Contexto

Complementa la regla de **reserva única** (`reserva-unica-cliente-producto`): aquel barrido cierra como `NO_SHOW` las citas pasadas **sin visita** (el paciente no llegó). Este change gestiona el caso opuesto: citas pasadas **con visita** (el paciente llegó) que **no alcanzaron desenlace**. La `Visit` es la fuente de verdad de "vino o no"; el estado de la cita no lo es.

## Definiciones

### Qué es un "episodio sin cerrar"
Una cita cuyo **día ya pasó** y cuyo episodio está **abierto**:
- tiene `Visit` en estado **no terminal** (`WAITING` o `IN_PROGRESS`), o
- tiene una `Revision` **iniciada y no completada**.

No entran aquí las citas **sin visita** (esas son no-show/cancelar → worklist de reservas + barrido) ni las ya resueltas (`Visit COMPLETED/LEFT/CANCELLED`, revisión completada, o cita `ATTENDED/CANCELLED/NO_SHOW`).

### Estado atascado mostrado
- **"Esperó sin ser atendido"**: `Visit WAITING`.
- **"En sala sin revisión"**: `Visit IN_PROGRESS`, sin `Revision`.
- **"Revisión a medias"**: `Revision` iniciada, sin `completedAt`.

Cada fila muestra además el **médico responsable** (de la cita/visita) y la **antigüedad** (días desde la cita).

## Decisiones

### 1. Separación del "Sin cerrar" de reservas
La worklist de reservas "Sin cerrar" pasa a mostrar **solo citas sin visita** (candidatas a no-show/cancelar). Los episodios con visita van al **panel nuevo**. Así cada lista tiene acciones que su dueño puede ejecutar de verdad.

### 2. Taxonomía de cierre (4)
Cada cierre **registra el motivo**; nunca se fabrica un desenlace clínico.

| # | Cierre | Rol | Representación en datos | Efecto KPI |
|---|---|---|---|---|
| ① | **Se fue** | Recepción / Médico | `Visit.status = LEFT` (existe) | Fuga "se fue" (ya se cuenta en el embudo) |
| ② | **Completada tarde** | Médico | Completa `Revision` (apto/no-apto) → cita `ATTENDED`; `Revision.closedLate = true` si `completedAt` > día de la cita | Visita completada + aptitud (normal) + métrica "fuera de plazo" |
| ③ | **Anulada (error)** | Recepción / Admin | Se descarta la visita (`Visit.status = CANCELLED` + motivo, o borrado lógico) → la cita vuelve a "sin visita" | Excluida (ruido), como `DUPLICADA/ERROR` hoy |
| ④ | **Cierre administrativo** | **Solo Admin** | Estado terminal propio (ver §3) + auditoría | Bucket "sin resolver", **aislado** de KPIs clínicos, **visible** |

### 3. Representación del cierre administrativo (④)
Necesita un estado terminal que **no** es apto/no-apto, ni no-show, ni "se fue". Opciones:
- **(Preferida)** `AppointmentStatus.CLOSED_ADMIN` (nuevo valor del enum) + `Appointment.adminClosure` (motivo/nota) + entrada en `audit_logs` (quién/cuándo). La `Visit` se marca `CANCELLED` con motivo "cierre administrativo".
- Alternativa: no tocar el enum y usar un flag `Appointment.adminClosedAt` + `adminClosedReason`; el panel/analítica lo tratan como terminal. Menos limpio para las vistas de agenda.

Se decide en implementación; la spec exige el comportamiento (terminal, auditado, aislado, visible), no el nombre exacto del campo.

### 4. Acople "cierre del episodio → cita resuelta"
Al cerrar el episodio, la cita debe **salir del panel** y quedar consistente:
- ② completar revisión → `ATTENDED`.
- ① se fue (`Visit LEFT`) → la cita se considera resuelta por el estado terminal de la visita (el panel filtra por visita no-terminal). *Decisión a validar*: si se quiere reflejarlo también en el estado de la cita, se hará de forma consistente (sin usar `NO_SHOW`, que sería falso).
- ③ anular → la cita vuelve a "sin visita" y sigue su vía (no-show/cancelar/reprogramar).
- ④ cierre administrativo → estado terminal propio.

### 5. Roles y permisos
- **Panel visible**: `RECEPTIONIST`, `DOCTOR`, `ADMIN` (con aislamiento por tenant/centro habitual).
- **Acciones**: ① y ③ → recepción/admin; ② → solo médico; ④ → **solo admin**. El backend valida el rol en cada acción.

### 6. Trazabilidad y aislamiento en KPIs
- **No contaminan** las tasas clínicas: ③ (anulada) y ④ (cierre administrativo) se **excluyen** de embudo/aptitud/no-show, igual que la analítica ya excluye `DUPLICADA/ERROR`.
- **Nunca se ocultan**: cada ③/④ deja **auditoría por caso** (actor, fecha, nota) y suma a una **métrica propia** ("episodios sin resolver" / "cierres administrativos" / "cerradas fuera de plazo"). Un número alto = problema de proceso, visible para admin.

### 7. Prevención — aviso de fin de día
Un cron a última hora del día lista los episodios abiertos del día (o sin cerrar acumulados) y notifica a médico/recepción/admin, para cerrarlos en el mismo día y minimizar huérfanas. Reutiliza la infraestructura de notificaciones/cron existente.

## Fuera de alcance
- Reabrir/editar diagnósticos ya emitidos.
- Facturación / implicaciones legales del acto no cerrado (solo se hace visible; la gestión legal es externa).
