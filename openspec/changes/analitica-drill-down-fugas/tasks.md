## 1. Backend — detalle por tipo de fuga

- [ ] 1.1 Definir el mapa `type` → criterio (where) reutilizando los `*ScopeWhere` de `analytics.ts`, para que el detalle cuadre con el agregado del embudo/fugas
- [ ] 1.2 `GET /analytics/funnel/leaks?type=&from=&to=&centerId=&doctorId=&productId=` → lista de casos (cliente, fecha, producto, sala/centro + dato propio del motivo); con límite/paginación
- [ ] 1.3 Casos especiales: `se_fue` (sobre `visits LEFT`), `sin_resolver` (`CLOSED_ADMIN` + nota/actor de `audit_logs`), `fuera_de_plazo` (`revisions closedLate`)
- [ ] 1.4 Guard de rol coherente con el resto de Analítica; aislamiento por tenant/centro
- [ ] 1.5 Tests: que el recuento del detalle == el agregado del embudo para cada `type`

## 2. Frontend — panel de detalle

- [ ] 2.1 Hacer clicables las filas de "Fugas del periodo" (y opcional: los Δ del embudo)
- [ ] 2.2 Panel lateral/drawer que consulta el endpoint con los filtros activos y lista los casos
- [ ] 2.3 Fila del detalle: nombre → `ClientInfoModal`, fecha, producto, sala/centro, dato del motivo (nota de cierre admin., motivo de cancelación, fecha de revisión tardía)
- [ ] 2.4 Estados vacío/carga/error; cerrar el panel

## 3. Verificación

- [ ] 3.1 `tsc --noEmit` (api + web) limpio
- [ ] 3.2 Tests en verde (cuadre detalle↔agregado)
- [ ] 3.3 Prueba manual con datos reales del tenant (que "No-show N" liste N citas, etc.)
