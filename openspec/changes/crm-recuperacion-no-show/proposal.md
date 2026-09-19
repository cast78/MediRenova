## Why

Cuando un paciente **no se presenta** a su cita —marcado `NO_SHOW` a mano por recepción o de forma **automática** por el barrido de +2 días— esa reserva perdida **deja de gestionarse**. Hoy:

- Sale de la worklist **"Sin cerrar"** en cuanto pasa a `NO_SHOW` (ya no es `PENDING`/`CONFIRMED`).
- Solo reaparece **mezclada con "Canceladas"** en el filtro del calendario, o como una **métrica** en Analítica → "Dónde se pierde".
- **No hay ninguna bandeja de recuperación**: nadie tiene una lista de "estos pacientes faltaron, hay que contactarles y reagendarles". El no-show consumado se convierte en un número, no en una acción.

Para un centro de reconocimiento, cada no-show es una **cita (e ingreso) perdida recuperable**: basta un contacto y un nuevo hueco. Falta el flujo operativo que convierta esos no-shows en citas recuperadas, con su **tasa de recuperación** como KPI de negocio.

## What Changes

- **Nueva pestaña "Recuperar"** dentro de Reservas (junto a "Sin cerrar" y "Episodios"), visible para `RECEPTIONIST` y `ADMIN`, con **badge de pendientes**.
- **Bandeja de no-shows recientes** (ventana configurable, por defecto **30 días**): cada fila muestra el paciente, la cita perdida (fecha, producto, sala/centro), **cómo se cerró** (Auto / Manual), el teléfono y los **canales consentidos (RGPD)**.
- **Estado de seguimiento** por no-show: *Pendiente* → *Contactado* → *Descartado*; y *Recuperado* **derivado** (el cliente ya tiene una **cita nueva del mismo producto** creada tras el no-show).
- **Acciones por fila**:
  - **Invitar a reagendar**: un **modal propio nuevo** que reutiliza la carcasa de "Pedir confirmación" (WhatsApp / Email / Copiar enlace + gating RGPD) pero genera un **enlace de reserva nueva** (`/link/generate` → `/booking/:token`), con un texto de recuperación por defecto.
  - **Contactado** / **Descartar**: registran el estado de seguimiento.
  - **Reagendar** (manual): reutiliza el asistente de "Nueva reserva" pre-rellenado con cliente + producto.
- **Resumen** de la bandeja: *sin gestionar · contactadas · recuperadas + tasa de recuperación*.

**No-goals (Fase 2, fuera de alcance aquí):**
- Editar el **texto** desde la interfaz (plantillas de avisos editables) → irá a **Configuración → Plantillas de avisos** (`MessageTemplate` con `kind`), desacoplado de Campañas.
- Envío **proactivo automático** de un aviso al producirse el no-show.

## Capabilities

### New Capabilities

- `crm-recuperacion-no-show`: Bandeja operativa (recepción/admin) de recuperación de no-shows recientes, con estado de seguimiento (pendiente/contactado/descartado/recuperado), invitación a reagendar reutilizando el enlace mágico de reserva y respetando el consentimiento RGPD, y tasa de recuperación como KPI.

### Modified Capabilities

- `appointments`: se añade el listado de no-shows para recuperación y el estado de seguimiento por cita (tabla dedicada `NoShowRecovery`, sin ensuciar `Appointment`).
- `magic-link`: se reutiliza `/link/generate` (enlace de reserva nueva) como destino de la invitación a reagendar; sin cambios de contrato.

## Impact

- **Modelos → migración**: nueva tabla `NoShowRecovery` (`appointmentId` único, `state`, `at`, `byUserId`, `note?`). No se toca `Appointment`.
- **Backend**: endpoint de listado de no-shows con ventana + filtro + contadores; endpoint de estado de seguimiento; ambos con rol RECEPTIONIST y aislamiento por tenant/centro. Reutiliza `/link/generate` y los flags de consentimiento del cliente.
- **Frontend**: pestaña "Recuperar" en Reservas + vista bandeja; modal propio `InviteRebookModal`; reutilización del asistente de Nueva reserva para el reagendado manual.
- **Analítica**: sin cambios (la bandeja consume el mismo `NO_SHOW`; la tasa de recuperación se calcula en el endpoint de la bandeja).
- **Fases**: esta es la Fase 1 (bandeja + invitación con texto por defecto). La Fase 2 (plantillas editables en Configuración + aviso automático) se documentará aparte.
