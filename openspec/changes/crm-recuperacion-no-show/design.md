# Design — crm-recuperacion-no-show (Fase 1)

## Contexto reutilizado (ya existe, no se toca)

- **Marca de no-show**: manual (`PATCH /appointments/:id { status: "NO_SHOW" }`, recepción/admin) y automática (`sweepExpiredAppointments`, +2 días sin visita → `NO_SHOW` + `autoClosed: true`). El flag `autoClosed` distingue **Auto** vs **Manual** en la bandeja.
- **Enlace de reserva nueva**: `POST /link/generate { customerId, productId }` → `/booking/:token` (auto-reserva del paciente). Es el mismo mecanismo de los recordatorios de renovación. Una cita `NO_SHOW` **no se reprograma** (el reagendar exige `PENDING`/`CONFIRMED`), por eso el paciente **reserva una cita nueva**.
- **Consentimiento RGPD**: los flags de canal del cliente (los que ya usa "Pedir confirmación") gobiernan qué botones (WhatsApp/Email) se habilitan.
- **Modal "Pedir confirmación"** (`ConfirmModal`): se usa como **referencia de carcasa** (WhatsApp/Email/Copiar + gating), no se modifica; el nuevo modal es propio para mantener los flujos desacoplados y permitir en Fase 2 su plantilla editable.

## Modelo de datos — `NoShowRecovery` (tabla dedicada, decisión confirmada)

```prisma
enum NoShowRecoveryState {
  CONTACTED
  DISMISSED
}

model NoShowRecovery {
  id            String              @id @default(uuid())
  tenantId      String              @map("tenant_id")
  appointmentId String              @unique @map("appointment_id")
  state         NoShowRecoveryState
  at            DateTime            @default(now())
  byUserId      String?             @map("by_user_id")
  note          String?
  createdAt     DateTime            @default(now()) @map("created_at")
  updatedAt     DateTime            @updatedAt @map("updated_at")

  appointment Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
  @@index([tenantId])
  @@map("no_show_recovery")
}
```

- **Pendiente** = no existe registro para la cita.
- **Contactado / Descartado** = `state`. `reset` = borra el registro (vuelve a Pendiente).
- No se ensucia `Appointment`; el borrado en cascada evita huérfanos.

## Estados de una fila (derivación)

Para cada cita `NO_SHOW` de la ventana:

1. **Recuperada** (derivado, decisión: **mismo producto**): el cliente tiene **otra cita** del **mismo `productId`** con `createdAt` posterior al `updatedAt`/`scheduledAt` del no-show y estado no cancelado (`PENDING`/`CONFIRMED`/`ATTENDED`). Tiene prioridad sobre el estado de seguimiento.
2. Si no está recuperada, se mira `NoShowRecovery`:
   - `DISMISSED` → **Descartada**.
   - `CONTACTED` → **Contactada**.
   - sin registro → **Pendiente**.

El **badge** de la pestaña y el KPI "sin gestionar" cuentan solo **Pendientes**. La **tasa de recuperación** = recuperadas / total en la ventana.

## Endpoints (backend)

### `GET /appointments/no-shows`
- **Rol**: `requireRole("RECEPTIONIST")` (→ recepción + admin). Aislado por tenant; por centro si `ctx.centerId`.
- **Query**: `window` (días, default 30, máx 180), `filter` (`pending` | `contacted` | `recovered` | `all`, default `pending`), `page`, `limit`.
- **Base**: `Appointment` con `status: "NO_SHOW"`, `scheduledAt >= hoy - window`. Se cruza con `NoShowRecovery` y con la derivación de "recuperada".
- **Cada fila**: `{ appointment: { id, scheduledAt, autoClosed, product{id,name}, room{name, center{id,name}} }, customer: { id, firstName, lastName, phone, email, consent{whatsapp,email} }, closedBy: "auto"|"manual", recoveryState: "pending"|"contacted"|"dismissed"|"recovered", recoveredAppointmentId?, contactedBy?, contactedAt? }`.
- **Meta**: `{ page, limit, total, pages, counts: { pending, contacted, recovered, ratio } }`.

### `POST /appointments/:id/recovery`
- **Rol**: `requireRole("RECEPTIONIST")`.
- **Body**: `{ state: "contacted" | "dismissed" | "reset", note?: string }`.
- Valida que la cita es del tenant y está en `NO_SHOW`. Upsert/borrado en `NoShowRecovery` (`byUserId = ctx.userId`). Registra `CustomerEvent` (`type: "noshow_contactado" | "noshow_descartado"`, actor `recepcion`) para la traza en la ficha.

### Reutilizados sin cambios
- `POST /link/generate { customerId, productId }` → enlace de reserva para la invitación.
- Asistente de "Nueva reserva" (frontend) para el reagendado manual.

## Frontend

- **Pestaña "Recuperar"** en Reservas (`sincerrar`/`episodios` ya existen como pestañas; se añade `recuperar`), con badge = `counts.pending`.
- **Vista bandeja**: cabecera con 3 KPIs (sin gestionar / contactadas / recuperadas + tasa), sub-filtros (Pendientes/Contactadas/Recuperadas/Todas) mapeados a `filter`, selector de ventana (15/30/60/90), lista paginada de filas.
- **Fila**: avatar + nombre, badge Auto/Manual, "Faltó el {fecha}", producto · sala · centro, teléfono. Acciones: **Invitar a reagendar** (modal), **Contactado**, **Descartar**, **Reagendar** (manual). Estados Contactada/Recuperada con estilo atenuado + sello (por quién/cuándo).
- **`InviteRebookModal`** (nuevo): genera el enlace con `/link/generate`, compone el texto de recuperación por defecto, ofrece WhatsApp/Email/Copiar enlace habilitados por consentimiento. Botón "Marcar contactado" tras enviar (o el usuario lo pulsa a mano).

### Texto por defecto (Fase 1, en frontend)
```
Hola {nombre}, no pudo acudir a su cita en {centro}. Puede reservar un nuevo día
en un momento desde aquí: {enlace}
```
Variables sustituidas con datos de la fila (`{nombre}`, `{centro}`, `{enlace}`). En Fase 2 pasa a plantilla editable en Configuración.

## Enlace de recuperación (trazabilidad)

Al **reagendar manualmente** un no-show (backoffice), la cita nueva se **enlaza** al no-show
mediante `Appointment.recoveredFromId` (self-relation `recoveredFrom`/`recoveredBy`), **separada**
de la de reprogramación (`rescheduledFrom`) para no pintarla como "Reprogramada". El no-show
**conserva su estado NO_SHOW** (métrica intacta); el enlace solo sirve para:

- Marcar la fila como **"Recuperada"** de forma **explícita** (prioridad sobre la heurística).
- Mostrar el rastro en el popup de la cita: *"Recuperada del no-show del {fecha} →"* (en verde,
  distinto del violeta de reprogramación), navegable a la cita origen.

`POST /appointments` acepta `recoveredFromId` opcional; se valida que sea un `NO_SHOW` del **mismo
cliente y producto** (si no encaja, se ignora sin bloquear). La derivación "recovered" del listado
usa el **enlace explícito** (`recoveredBy`) y, como respaldo, la **heurística** (mismo producto +
cita posterior) para recuperaciones hechas fuera del flujo (p. ej. el enlace mágico, cuyo sellado
del enlace queda para Fase 2).

## Diferencia reprogramada vs reagendada

- **Reprogramada** (`RESCHEDULED`): mueve una cita **futura y válida** (PENDING/CONFIRMED) antes de
  ocurrir; la vieja pasa a `RESCHEDULED` (el hueco se libera) y se enlaza con la nueva.
- **Reagendada** (recuperación de no-show): la cita **ya pasó** y no se realizó; el no-show
  **sigue** `NO_SHOW` (hecho + métrica) y se crea una cita **nueva** enlazada por `recoveredFromId`.

## Decisiones (confirmadas)

1. **Modelo**: tabla dedicada `NoShowRecovery` (desacoplado). ✅
2. **Ventana** por defecto: **30 días**. ✅
3. **"Recuperada"**: exige **mismo producto**. ✅
4. **Texto**: el de arriba. ✅

## Riesgos / notas

- El teléfono/email en la bandeja se muestran para contacto; se respeta consentimiento en los botones de envío (no se envía por un canal no aceptado).
- La derivación "recuperada" es en runtime (sin materializar); coste acotado por la ventana de 30 días y el filtro por producto.
- `reset` permite corregir un "contactado/descartado" erróneo (vuelve a Pendiente).
