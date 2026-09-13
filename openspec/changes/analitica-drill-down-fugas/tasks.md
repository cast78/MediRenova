## 1. Backend — detalle por tipo de fuga

- [x] 1.1 Mapa `type` → criterio (where) reutilizando los `*ScopeWhere` de `analytics.ts`, para que el detalle cuadre con el agregado del embudo/fugas
- [x] 1.2 `GET /analytics/funnel/leaks?type=&from=&to=&centerId=&doctorId=&productId=` → lista de casos (cliente, fecha, producto, sala/centro + dato propio del motivo); cap de 500
- [x] 1.3 Casos especiales: `se_fue` (sobre `visits LEFT`), `sin_resolver` (`CLOSED_ADMIN` + nota/actor), `fuera_de_plazo` (`revisions closedLate`)
- [x] 1.4 Guard de rol (ADMIN, como el resto de Analítica); aislamiento por tenant/centro
- [x] 1.5 Verificado el cuadre detalle==agregado para los 8 tipos (sonda de solo lectura contra datos reales; el where/rango es el mismo que `computeFunnel`)

## 2. Frontend — panel de detalle

- [x] 2.1 Filas de "Fugas del periodo" clicables (las que tienen casos) → abren el detalle
- [x] 2.2 Panel lateral (`LeakDrawer`) que consulta el endpoint con los filtros activos y lista los casos
- [x] 2.3 Fila del detalle: nombre → `ClientInfoModal`, fecha, producto, sala/centro, dato del motivo (nota de cierre admin., motivo de cancelación, fecha/desenlace de revisión tardía)
- [x] 2.4 Estados vacío/carga/error; cerrar el panel

## 3. Verificación

- [x] 3.1 `tsc --noEmit` (api + web) limpio
- [x] 3.2 Suite existente en verde (159); el cuadre detalle↔agregado se verificó con sonda de datos reales (no se añadió test de integración con BD, siguiendo la convención de tests de núcleo puro)
- [x] 3.3 Prueba con datos reales del tenant "Clínica Demo": no_show 43, reprog. 3, se fue 1, sin resolver 1 — detalle == agregado

## Pendiente (UI, opcional)

- [ ] Hacer también clicables los Δ del embudo (además de la tarjeta de fugas) — no imprescindible; la tarjeta ya cubre todos los motivos.
