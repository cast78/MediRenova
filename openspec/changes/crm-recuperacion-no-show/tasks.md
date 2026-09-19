## 1. Modelo de datos

- [x] 1.1 Migración: enum `NoShowRecoveryState` (`CONTACTED` | `DISMISSED`) + tabla `NoShowRecovery` (`appointmentId` único, `state`, `at`, `byUserId?`, `note?`, timestamps; FK a `Appointment` con `onDelete: Cascade`)
- [x] 1.2 Relación inversa en `Appointment` (`noShowRecovery NoShowRecovery?`)
- [x] 1.3 `prisma migrate` + regenerar cliente

## 2. Backend — listado

- [x] 2.1 Núcleo puro `deriveRecoveryState(noShow, recoveryRow, hasNewerSameProduct)` → `"pending" | "contacted" | "dismissed" | "recovered"` (testeable sin BD)
- [x] 2.2 `GET /appointments/no-shows` (rol RECEPTIONIST, tenant/centro): base `NO_SHOW` en ventana; cruce con `NoShowRecovery`; derivación "recuperada" (**mismo producto**, cita nueva creada después); filtro `pending|contacted|recovered|all`; paginación
- [x] 2.3 `counts` en meta (pending / contacted / recovered / ratio) para el resumen y el badge
- [x] 2.4 Cada fila incluye `closedBy` (auto/manual vía `autoClosed`), producto, sala/centro, teléfono/email y **flags de consentimiento**
- [x] 2.5 Tests del núcleo de derivación

## 3. Backend — estado de seguimiento

- [x] 3.1 `POST /appointments/:id/recovery { state: "contacted"|"dismissed"|"reset", note? }` (rol RECEPTIONIST): upsert/borrado en `NoShowRecovery` con `byUserId = ctx.userId`
- [x] 3.2 Validar que la cita es del tenant y está en `NO_SHOW`
- [x] 3.3 Registrar `CustomerEvent` (`noshow_contactado` / `noshow_descartado`, actor `recepcion`) para la traza en la ficha del cliente

## 4. Frontend — pestaña y bandeja

- [x] 4.1 Añadir pestaña **"Recuperar"** en Reservas (junto a Sin cerrar / Episodios) con badge = `counts.pending`
- [x] 4.2 Vista bandeja: 3 KPIs (sin gestionar / contactadas / recuperadas + tasa), sub-filtros (Pendientes/Contactadas/Recuperadas/Todas), selector de ventana (15/30/60/90)
- [x] 4.3 Fila: avatar + nombre, badge Auto/Manual, "Faltó el {fecha}", producto · sala · centro, teléfono; estilos atenuados + sello para Contactada/Recuperada
- [x] 4.4 Acciones por fila: **Invitar a reagendar** (modal), **Contactado**, **Descartar**, **Reagendar** (manual → asistente de Nueva reserva pre-rellenado)

## 5. Frontend — modal Invitar a reagendar

- [x] 5.1 `InviteRebookModal` (propio, no reutiliza `ConfirmModal`): genera enlace con `/link/generate { customerId, productId }`
- [x] 5.2 Texto de recuperación por defecto (hardcodeado en Fase 1) con `{nombre}` / `{centro}` / `{enlace}`
- [x] 5.3 Botones **WhatsApp / Email / Copiar enlace** habilitados según consentimiento RGPD (misma regla que "Pedir confirmación")
- [x] 5.4 Tras enviar, ofrecer "Marcar contactado" (o dejarlo a la acción de fila)

## 5b. Enlace de recuperación (trazabilidad)

- [x] 5b.1 Migración: `Appointment.recoveredFromId` + self-relation `recoveredFrom`/`recoveredBy` (separada de `rescheduledFrom`)
- [x] 5b.2 `POST /appointments` acepta `recoveredFromId` opcional; se valida NO_SHOW del mismo cliente+producto (si no encaja, se ignora)
- [x] 5b.3 Reagendado manual (rebook) sella `recoveredFromId` cuando el origen es NO_SHOW
- [x] 5b.4 Listado de no-shows: "recovered" por enlace explícito (`recoveredBy`) + heurística de respaldo
- [x] 5b.5 Popup de la cita: rastro "Recuperada del no-show del {fecha} →" (verde), navegable
- [x] 5b.6 Texto de invitación opción A (producto + fecha + "sigue pendiente", no culpabilizador)

## 5c. Enlace corto para el mensaje (magic link)

- [x] 5c.1 Tabla `ShortLink` (code aleatorio → token, con caducidad); migración
- [x] 5c.2 `/link/generate` devuelve `…/b/CODE` (token de 30 días) + endpoint público `GET /link/short/:code`
- [x] 5c.3 Página web `/b/[code]` resuelve y redirige a `/booking/:token`
- [x] 5c.4 Mensaje de invitación con salto de línea antes del enlace; asunto de email "MediRenova - Reagenda tu cita"

## 5d. Rediseño de la bandeja (vía, nota, recepcionista, estados)

- [x] 5d.1 Migración `NoShowRecovery.channel` (phone/whatsapp/email) + relación al usuario
- [x] 5d.2 Listado enriquecido: vía, recepcionista (`byUser`), nota, cuándo; para recuperadas, fecha de la cita nueva + quién; `counts.dismissed`
- [x] 5d.3 KPIs con color (4: sin gestionar / contactadas / recuperadas·tasa+nota / descartadas) y pestaña "Descartadas"
- [x] 5d.4 Filas por estado con iconos y botones de color (Reagendar / Invitar / Registrar llamada / Descartar rojo / Reabrir verde / Ver cita nueva)
- [x] 5d.5 "Registrar llamada" y "Descartar" con mini-modal de nota; el modal de invitar sella la vía (whatsapp/email); "Reagendar" abre el popup de gestión (trazabilidad)

## 6. Verificación

- [x] 6.1 Typecheck API + web en verde
- [ ] 6.2 Prueba E2E manual: marcar no-show → aparece en "Recuperar" → invitar (enlace correcto) → contactado → reagendar (cita nueva mismo producto) → pasa a "Recuperada" y sale de pendientes
- [ ] 6.3 Comprobar aislamiento por centro y gating RGPD (canal no consentido no se habilita)

## Fase 2 (anotado, fuera de alcance)

- [ ] **Configuración → Plantillas de avisos**: `MessageTemplate` con `kind` (`CAMPAIGN` | `TRANSACTIONAL`); hacer editables confirmación + reagenda; un solo motor `renderTemplate`.
- [ ] Aviso **proactivo automático** al producirse el no-show (opt-in), enganchado al workflow existente.
