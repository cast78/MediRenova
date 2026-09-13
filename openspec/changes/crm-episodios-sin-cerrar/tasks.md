## 1. Detección y panel (backend)

- [x] 1.1 Núcleo puro `classifyStuckEpisode(appt, visit, revision)` → `"esperó" | "en_sala" | "revision_a_medias" | null` (testeable sin BD)
- [x] 1.2 `GET /appointments/unclosed-episodes`: citas pasadas con visita no terminal / revisión a medias; incluye estado atascado, médico responsable y antigüedad (días)
- [x] 1.3 Ajustar `GET /appointments/unclosed` (worklist de reservas) para **excluir** citas con visita → solo no-show/cancelar
- [x] 1.4 Tests del núcleo de clasificación

## 2. Acciones de cierre (backend, por rol)

- [x] 2.1 ① `POST /appointments/:id/left` (recepción/médico): marca `Visit LEFT` + resuelve la cita; graba motivo
- [x] 2.2 ③ `POST /appointments/:id/void-visit` (recepción/admin): descarta la visita (llegada errónea) → cita vuelve a "sin visita"; excluida de KPIs
- [x] 2.3 ④ `POST /appointments/:id/admin-close` (**solo admin**): estado terminal de cierre administrativo + nota; entrada en `audit_logs`
- [x] 2.4 ② al completar `Revision` fuera del día de la cita → set `Revision.closedLate = true` (auto, sin acción manual nueva)
- [x] 2.5 Guards de rol en cada endpoint (recepción/médico/admin según acción)

## 3. Migración

- [x] 3.1 `Revision.closedLate` (boolean, default false)
- [x] 3.2 Cierre administrativo en `Appointment` (estado `CLOSED_ADMIN` + `adminClosedAt/ById` + `adminClosureNote`)
- [x] 3.3 Motivo de visita anulada (`Visit.cancelReason`, texto)

## 4. Panel (frontend)

- [x] 4.1 Vista/pestaña **"Episodios sin cerrar"** (recepción/médico/admin), separada del "Sin cerrar" de reservas
- [x] 4.2 Fila con chip de estado atascado + médico responsable + antigüedad; nombre → ficha del cliente
- [x] 4.3 Acciones por rol: ① Se fue · ② Ver revisión (médico) · ③ Anular (error) · ④ Cierre administrativo (solo admin), con confirmación en las destructivas
- [x] 4.4 Quitar de la worklist de reservas los casos con visita (ya viven aquí)

## 5. Analítica y trazabilidad

- [x] 5.1 Bucket "sin resolver" (cierres administrativos) + métrica "cerradas fuera de plazo", **aislados** de tasas clínicas
- [x] 5.2 Excluir ③ (anuladas) y ④ (administrativas) de embudo/aptitud/no-show (como `DUPLICADA/ERROR`)
- [x] 5.3 Auditoría por caso para ③ y ④ — se graba en `audit_logs` (actor/fecha/nota); la nota y la fecha del cierre administrativo, y el "fuera de plazo", se ven en el flujo de la cita (timeline). (Visor dedicado de `audit_logs` con el actor: futuro)

## 6. Prevención — avisos

- [x] 6.1 Cron de **fin de día** (20:00 Europe/Madrid): lista episodios abiertos → **email** al personal (ADMIN + recepción) con email válido. Núcleo puro `episodeDigest` testeado. (`episode-alerts.ts` + `workflow-cron.ts`)
- [x] 6.2 Indicador in-app: **badge de conteo** en el menú "Reservas" (todo el personal), refresco cada minuto.
- Nota: WhatsApp/SMS al **personal** queda pendiente — el modelo `User` no tiene teléfono ni preferencias de canal (los consentimientos actuales son del paciente). Requiere un mini-feature de "preferencias de notificación del personal" (migración + ajustes). Documentado para fase posterior.

## 7. Verificación

- [x] 7.1 `tsc --noEmit` (api + web) y build limpios
- [x] 7.2 Tests en verde (clasificación + aislamiento en KPIs + digest de aviso) — 162 en verde
- [x] 7.3 Migración aplicada en Neon (`prisma migrate deploy`) — hecha por el usuario ("All migrations have been successfully applied")
