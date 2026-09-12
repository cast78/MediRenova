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
- [~] 5.3 Auditoría por caso (actor/fecha/nota) para ③ y ④ — **se graba** en `audit_logs`; falta un visor por caso en la UI (pendiente)

## 6. Prevención — avisos (fase posterior)

- [ ] 6.1 Cron de **fin de día**: lista episodios abiertos → notifica a médico/recepción/admin
- [ ] 6.2 (Opcional) indicador de conteo de episodios abiertos en el dashboard de admin

## 7. Verificación

- [x] 7.1 `tsc --noEmit` (api + web) y build limpios
- [x] 7.2 Tests en verde (clasificación + aislamiento en KPIs) — 159 en verde
- [ ] 7.3 Migración aplicada en Neon (`prisma migrate deploy`) fuera de picos de uso — **acción del usuario**
