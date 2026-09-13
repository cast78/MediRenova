## Why

El **Embudo de conversión** ya muestra las tasas y, junto a él, la tarjeta **"Fugas del periodo"** con los recuentos por motivo (no-show, canceladas por cliente/centro/otras, reprogramadas, se fue) y los episodios aislados (sin resolver, completadas fuera de plazo). Hoy esos números son **solo agregados**: cuando un responsable ve "No-show 42" o "Sin resolver 1" no puede saber **qué citas/clientes** hay detrás sin salir a rebuscar en Reservas.

Falta el **último paso de una analítica accionable**: poder **pinchar un dato de fuga y ver la lista** de casos concretos que lo componen (con los filtros activos), para actuar —recontactar, revisar, corregir— en vez de solo medir.

## What Changes

- **Drill-down desde "Fugas del periodo"**: cada fila (y, si encaja, cada Δ del embudo) se vuelve **clicable** y abre un **panel lateral** con la **lista de citas/clientes** detrás de ese número.
- La lista **respeta los filtros activos** del informe (rango de fechas, centro, médico, producto).
- Cada fila del detalle muestra lo relevante del caso: **cliente** (enlace a su ficha), **fecha**, **producto**, **sala/centro**, y el dato propio del motivo (p. ej. la **nota** del cierre administrativo, el **motivo** de cancelación, o la fecha de la revisión tardía).
- Mapa motivo → datos:
  - **No-show / Reprogramadas**: citas con ese estado.
  - **Canceladas (cliente/centro/otras)**: citas `CANCELLED` por ese motivo.
  - **Se fue**: visitas `LEFT`.
  - **Sin resolver**: citas `CLOSED_ADMIN` (+ nota y actor de la auditoría).
  - **Completadas fuera de plazo**: revisiones `closedLate`.
- **Sin duplicar lógica de KPI**: el detalle usa exactamente los mismos criterios que el agregado (mismos filtros/where), para que la suma del detalle cuadre con el número.

## Capabilities

### Modified Capabilities

- `analytics`: se añade la consulta de **detalle por tipo de fuga** (drill-down) que devuelve la lista de casos detrás de cada recuento del embudo/fugas, con los filtros del informe; y el panel de detalle en el frontend.

## Impact

- **Backend**: nuevo endpoint de listado, p. ej. `GET /analytics/funnel/leaks?type=<no_show|cancel_cliente|cancel_centro|cancel_otras|reprogramada|se_fue|sin_resolver|fuera_de_plazo>&from&to&centerId&doctorId&productId`, reutilizando los `*ScopeWhere` existentes de `analytics.ts` para garantizar que el detalle cuadre con el agregado. Considerar paginación y un límite razonable.
- **Frontend** (`analitica/module.tsx`): hacer clicables las filas de "Fugas del periodo" (y opcionalmente los Δ del embudo) → abrir un panel lateral/drawer que consulta el endpoint y lista los casos, reutilizando `ClientInfoModal` para la ficha.
- **Sin migración**: solo consulta y UI; no cambia el modelo de datos.
- **Aislamiento**: respeta lo ya construido — "sin resolver" y "fuera de plazo" siguen fuera de las tasas; el drill-down solo los **lista**, no los suma a los KPIs clínicos.

## Notas de continuidad

- Complementa a `crm-episodios-sin-cerrar` (que introdujo `CLOSED_ADMIN`, `closedLate` y las métricas `sinResolver`/`completadasFueraDePlazo`, ya visibles en la tarjeta de fugas).
- Origen: pendiente acordado el 2026-09-13 para abordar el **2026-09-14**. Decisión de encaje (rama/PR propios) por confirmar al empezar.
