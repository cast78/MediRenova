Rama: `feat/crm-multidispositivo` desde `main`. Cada fase se mergea sola; la vista de escritorio no cambia en ninguna (todo actúa por debajo de `lg` o con puntero táctil). Mockup: "Tablet MediRenova" (artefacto).

**Orden acordado (14/10/2026)**
- **Fase A — Táctil y tablas (obligatoria)**: T0 → T3 → T2 → T6 (parcial). Cubre iPad Pro 13 y Surface Pro 10 al completo; no cambia la disposición.
- **Fase B — Disposición compacta (condicionada a D0)**: T1 → T5 → T4 → T4b → T6 (completa). Solo si se decide soportar tablets de 10–11" en vertical.

# Fase A — Táctil y tablas

## T0. Fundamentos

- [x] T0.1 `tailwind.config`: variantes `touch` (`pointer: coarse`) y `hover-none` (`hover: none`)
- [x] T0.2 `globals.css`: reglas táctiles globales (min-height 44 px en controles y filas, 16 px en inputs, tap-highlight, scroll-padding)
- [x] T0.3 `app/layout.tsx`: `viewport` con `viewport-fit=cover`; `100dvh` en contenedores a pantalla completa
- [x] T0.4 `docs/multidispositivo.md` (borrador): dispositivos, breakpoints, convenciones

## T2. Tablas y listas

- [x] T2.1 `components/ui/data-table.tsx`: envoltorio de la `<table>` existente con scroll propio y fundido, ancho mínimo, primera columna fija al desplazar y filas más altas en táctil (sin menú "⋯": las acciones ya miden 44 px tras T3)
- [x] T2.2 Envueltas las 16 tablas de 13 ficheros (clientes, médicos, formularios, revisiones, equipo, auditoría, agenda de reservas, destinatarios de campañas, comunicaciones, utilización, empresas, usuarios de empresa, 3 de analítica); columnas secundarias ocultas por debajo de `lg` (Alta en clientes; DNI y Nº colegiado en médicos; IP en auditoría)
- [ ] T2.3 Clientes: vista en tarjetas en `< lg` con conmutador recordado (según D2; Fase B)

## T3. Táctil

- [x] T3.1 Alturas y tamaños de icono bajo `touch:` en botones, chips, pestañas e iconos de acción
- [x] T3.2 Sustituir acciones solo-hover por `hover-none:opacity-100` (analítica, reservas, clientes, revisiones, consulta, visitas, utilización)
- [x] T3.3 `components/ui/tabs-scroller.tsx` (scroll-snap, fundido, activa a la vista, role=tab/aria-selected) aplicado a Reservas, Analítica/Captación, Configuración, Revisiones, Campañas, Productos, Utilización y ficha de empresa
- [x] T3.4 Tooltips como único canal → etiqueta visible o popover al tocar
- [x] T3.5 Pulido de controles: `RoomSelect` sin cabecera de centro (`optgroup`) cuando solo hay un centro (Visitas obliga a elegir centro; la cabecera es redundante y ocupa una línea en tablet)

## T6a. Verificación de la Fase A

- [x] T6a.1 Comprobación automática (script en el navegador) en 15 páginas con puntero táctil emulado: 0 controles < 44 px, 0 acciones solo-hover, 0 desbordamientos de página, 16/16 tablas dentro de `DataTable`. Nota: el navegador integrado solo emula táctil por debajo de 768 px; las reglas dependen del puntero, no de la anchura, así que el resultado vale para 1180×820 y 1376×1032 (pendiente T6a.3 en dispositivo real)
- [x] T6a.2 Antes/después en escritorio con ratón a 1440 px: huella de tamaños de todos los botones, campos, selects y tablas en 7 páginas comparada entre `main` (build temporal en :3005) y la rama (:3000): idéntica. Las dos únicas diferencias se debían al centro seleccionado guardado en cada origen, no al código
- [ ] T6a.3 Prueba en iPad Pro 13 y Surface Pro 10 reales: pulsación, zoom en inputs, scroll de tablas con el dedo
- [x] T6a.4 `docs/multidispositivo.md`: estado, dispositivos soportados (declaración "tablet de 11" o más, en horizontal" mientras no haya Fase B), convenciones y verificación realizada

# Fase B — Disposición compacta (solo si D0 = sí)

## T1. Shell

- [x] T1.1 `app-layout.tsx`: raíl de 64 px por debajo de `lg` (logo, iconos de 48 px con badge y candado, avatar); el aside de 224 px solo a partir de `lg` (`hidden lg:flex`, mismo marcado que antes)
- [x] T1.2 Cajón (280 px, overlay, `role=dialog`; se cierra al tocar fuera, al navegar, con Escape y al pasar a ≥ lg) con secciones, etiquetas, "Tu plan", usuario y cerrar sesión; se abre desde ☰, el logo y el avatar del raíl. Enlaces del menú a 44 px en táctil (`touch:py-3`)
- [x] T1.3 `context-bar.tsx` compacta en `< lg`: botón ☰ de 44 px, `px-3`, nombre de empresa truncado, selector de centro; en `≥ lg` sin cambios
- [x] T1.4 `SuperadminBar` a una línea en `< lg` (textos largos a `title`, "Volver" y "Ver como Pro" cortos); barra del modo proveedor con ☰ y sin email en `< lg`; el raíl muestra Empresas · Peticiones con badge. **Pendiente de validar por el usuario** (sin credenciales de superadmin en local)
- [x] T1.5 Verificado en local (9/11): 768×1024 y 820×1180 (raíl 64 px, barra compacta, 13 páginas sin desbordamiento de página, módulo activo marcado), 767 táctil (0 controles < 44 px en raíl y cajón, pie del cajón visible, nav con scroll propio), 1024×768 y 1440×900 (aside de 224 px, sin raíl ni ☰, barra con `px-6`, enlaces de 36 px como antes). Pendiente: 1180×820 en iPad real (T6b.3)

## T4. Reservas

- [x] T4.1 Pestañas de vistas con `TabsScroller` (hecho en T3); leyenda de estados como `StatusLegend`: fila de siempre en `≥ lg`, botón "Leyenda ▾" plegable en `< lg` (Semana, Mes y Día/timeline)
- [x] T4.2 En `< lg`, si la URL no fija vista, se abre la última usada en el dispositivo (`localStorage` `appt_view_compact`, por defecto Día); en escritorio sigue Mes
- [x] T4.3 Semana (D3 = 7 días desplazables): el calendario es un único contenedor con scroll en los dos ejes, 7 columnas de 160 px en `< lg` (`.wk-days`), ajuste por día (`snap-x snap-proximity`, `scroll-pl-12`), cabecera de días pegajosa arriba y columna de horas pegajosa a la izquierda; en `< lg` se limita al alto disponible de la pantalla (como una app de calendario); al abrir empieza en lunes (decisión del usuario, 13/11) y se sitúa en la hora actual (o la primera cita). Escala 1,6 px/min en `< lg`. Rejilla rediseñada (líneas de hora y media hora, fin de semana en gris, cajas con margen, franja de color por estado, nombre + hora). En `≥ lg` sin ancho mínimo ni límite de alto: la página se desplaza como antes
- [x] T4.4 Nueva reserva ya era hoja (lg, T5); el detalle de cita (md) pasa a hoja con `sheet` y cabecera pegajosa
- [x] T4.5 Selector de salas propio (`components/room-select.tsx`, mockup https://claude.ai/artifact/PmHh6KG1a14WprW3EYWjEN): botón con icono y sala elegida; en `≥ lg` desplegable bajo el botón, en `< lg` hoja pequeña centrada (`Modal` sm); salas agrupadas por centro con etiqueta solo si hay varios, punto de color por sala, marca en la seleccionada; cierre al elegir, fuera o Escape. Sustituye al `<select>` nativo en Reservas, Visitas, Revisiones y Utilización. Generalizado como `components/ui/select.tsx` (`Select`: opciones planas o agrupadas, `emptyLabel`, `title`, `icon`, `menu` button/right); `RoomSelect` es un envoltorio suyo y el asistente de nueva reserva lo usa para producto, centro y sala. Pendiente: migrar el resto de `<select>` de la app (filtros de analítica en T4b, formularios) de forma gradual

## T4b. Analítica y Captación (módulo compartido)

- [x] T4b.1 Barra de filtros: los 5 `<select>` de Analítica/Captación pasan al `Select` propio (`FilterSelect` con icono en botón, cabecera y filas; `MiniSelect` compacto para agrupar/ventana de las gráficas). En `< lg` los filtros de entidad caben en una fila de tres (198 px) y la sala pasa a la segunda; en hoja llevan icono, título y subtítulo. No hizo falta la variante "Filtros con contador": la barra ya envuelve y los chips de filtros activos siguen debajo. Sin cambios de disposición en `≥ lg`
- [x] T4b.2 Pestañas con `TabsScroller` (hecho en T3)
- [x] T4b.3 Revisado: "Dónde se pierde", "Fugas del periodo" y los accesos del resumen ya son botones/filas pulsables con chevron visible; el hover solo cambia el color. Sin cambios
- [x] T4b.4 Tablas ya en `DataTable` (T2). El panel lateral de casos de fuga (448 px desde la derecha) se mantiene: cabe en tablet vertical
- [x] T4b.5 Revisado: las gráficas ya van a todo el ancho con alto fijo (`ResponsiveContainer` 100 % × 260) y las rejillas de indicadores son `grid-cols-2 lg:grid-cols-4` o de 3 columnas que caben. Sin cambios

## T5. Modales y formularios

- [x] T5.1 `components/ui/modal.tsx`: en `≥ lg` el diálogo centrado de siempre (`size` xs–5xl, `z`, `backdrop`, `padding`, `locked`); en `< lg` los tamaños lg o más son hoja a pantalla completa (`100dvh`, clases `sheet-*` en `globals.css`, porque las variantes `max-lg:` no existen con pantallas `raw`). Dos modos: `title`/`footer` propios (cabecera y pie fijos, el botón de enviar se asocia al `<form>` por `id`) o contenido tal cual con las filas marcadas `sheet-head` / `sheet-foot` (pegajosas dentro del cuerpo con scroll). Cierre por fondo, X y Escape
- [x] T5.2 Migrados los 37 diálogos (`fixed inset-0`) a `Modal`: 36 por envoltorio mecánico (script con seguimiento de profundidad de `<div>`, sin tocar el contenido) y `NewCustomerModal` con `title`/`footer`. 14 hojas con `sheet-head`/`sheet-foot`: nueva reserva (3 pasos), aviso de episodios, plantilla/segmento/campaña/resultados, centro, sala, médico, producto, regla de workflow, nueva empresa, foto de consulta, editor de certificado, constructor de formularios. Confirmaciones (xs–md) y `PlanChangeDialog` siguen centradas en tablet. Fuera: el panel de filtros de analítica (T4b.1) y los dos cierres de menú `fixed inset-0 z-10`
- [x] T5.3 Revisado: consulta, ficha de cliente y alta de empresa ya van a una columna por debajo de `lg` (`lg:grid-cols-[1fr_340px]`, `sm:grid-cols-2` en pares de campos); `SignaturePad` ya es `w-full` + `touch-none`. Sin cambios necesarios
- [x] T5.4 Revisados los 56 grids sin breakpoint: los `grid-cols-2` (40) caben en tablet vertical (≥ 330 px por columna) y solo afectarían a móvil (fuera de alcance); cambiados los que no caben: filas de 4 indicadores en Revisiones, Productos y Campañas (`grid-cols-2 lg:grid-cols-4`), editor de certificado y constructor de formularios a una columna en `< lg` (`grid-cols-1 lg:grid-cols-[…]`)
- [x] T5.5 Migrados los 31 `<select>` nativos restantes al `Select` propio (14/11): Reservas (motivo de cancelación, ventana de recuperación), Configuración (auditoría, intervalo, zona horaria, retención), bandeja de comunicaciones (evento, estado, periodo), Equipo (rol, centro, filtro), walk-in, constructor de formularios (tipo de campo), alta de empresa (zona horaria, plan), campañas (plantilla, segmento), reserva pública (centro, sala), barra de contexto (centro), workflow, utilización, visitas ("Llamar a…", con `wrapperClassName`), consulta (campo de lista del formulario), productos, formularios, médicos. Icono acorde al menú en cada uno. Se mantiene nativo solo el `<select>` de vista previa del constructor de formularios (representa el campo del formulario público). Verificado en local: 0 `<select>` en 9 páginas, el filtro de rol de Equipo filtra la tabla, los diálogos de workflow y productos abren con el selector

## T6b. Verificación de la Fase B

- [x] T6b.1 Barrido en el navegador (13/11): 768×1024 en 13 páginas y 820×1180 · 1024×768 · 1180×820 en 6 páginas (dashboard, Reservas/Semana, Clientes, Analítica, Configuración, Centros): 0 desbordamientos de documento ni del contenedor principal, 0 elementos que sobresalgan del contenido (fuera de los carriles con scroll propio); raíl de 64 px por debajo de 1024 y menú de 224 px a partir de 1024; la Semana limita su alto en vertical (777 px a 820×1180) y no en horizontal. Objetivos ≥ 44 px y acciones solo-hover: cubiertos por el barrido táctil de la Fase A (reglas por puntero, no por anchura) más las medidas de T1 (raíl y cajón) y T5 (hojas)
- [x] T6b.2 Huella de tamaños (botones, campos, selects, tablas, enlaces) a 1440 px en 8 páginas, rama (:3000) frente a `main` (:3005, worktree temporal): idéntica en dashboard, Clientes, Visitas, Configuración y Centros; en Revisiones, Analítica y Reservas/Mes la única diferencia es que los `<select>` nativos son ahora botones del `Select` propio (3 en Analítica, 1 en Revisiones, 1 en Reservas), cambio deliberado de T4.5/T4b; la rejilla del Mes mide igual (976×533)
- [ ] T6b.3 Prueba en iPad 10.9" real (Safari) en vertical: teclado en pantalla con hojas, scroll de Semana. **Sin dispositivo**: validado por el usuario con la emulación de iPad de Edge/Chrome; queda pendiente para cuando haya un iPad
- [x] T6b.4 `docs/multidispositivo.md` final: tablets de 10–11" en vertical pasan a soporte completo; se retira la restricción "en horizontal"

## Decisiones pendientes (ver design.md)

- [x] D0 Fase A se hace; Fase B solo si se decide soportar tablets de 10–11" en vertical (pendiente)
- [ ] D1 Raíl + cajón vs solo cajón
- [ ] D2 Clientes: tabla con prioridades vs tarjetas por defecto en tablet
- [x] D3 Semana: **7 días desplazables** con ajuste por día y día actual centrado (decidido 13/11/2026)
- [ ] D4 "Añadir a pantalla de inicio" (manifest) sí/no
- [ ] D5 Móvil en fase posterior: alcance mínimo (Agenda del día, ficha de cliente)

## Punto de continuación (9/11/2026)

**Estado.** Fase A en producción (PR #22). Fase B en `feat/crm-multidispositivo`: T1 Shell (`8da0408`) y T5 diálogos (`c0d9438`) hechos, verificados en local y documentados. La rama lleva `main` al día (incluye la PR #23, ficha de Licencia). Sin PR de la Fase B todavía.

**Siguiente sesión.**
1. T4 Reservas: pestañas de vistas ya con `TabsScroller` (T4.1 parcial); falta leyenda plegable en `< lg`, vista Día por defecto en `< lg` recordada por dispositivo (T4.2), Semana con columnas de 160 px, scroll lateral con `scroll-snap`, cabecera fija y día actual centrado (T4.3, decisión D3), y comprobar nueva reserva / detalle de cita como hoja (T4.4, ya migrados en T5).
2. T4b Analítica y Captación: barra de filtros compacta con selectores en hoja (T4b.1; el panel lateral de filtros sigue con `fixed inset-0` propio), pestañas (ya con `TabsScroller`), filas pulsables, tablas (ya en `DataTable`), gráficas a todo el ancho.
3. T6b verificación de la Fase B (768×1024, 820×1180, 1024×768, 1180×820; escritorio sin cambios) y `docs/multidispositivo.md` final.
4. PR única de la Fase B a `main`.

**Pendiente de validar por el usuario** (sin credenciales de superadmin en local): modo proveedor y barra de superadmin en tablet vertical (T1.4). El usuario puede entrar como superadmin en el navegador de Claude en el puerto 3000 para que se mida.

**Notas técnicas.**
- Las variantes `max-lg:` de Tailwind no se generan porque `screens` tiene pantallas `raw`; lo que va solo por debajo de `lg` se escribe en `globals.css` o en positivo.
- El selector nativo de los `<select>` se ve enorme en la emulación táctil de Chrome DevTools: es el picker "móvil" de Chrome, no CSS de la app.
- Carpeta `.claude/worktrees/ux-licencia` (rama corta ya mergeada): el registro del worktree está quitado; la carpeta se borra con los servidores de desarrollo apagados.

## Punto de continuación (8/11/2026)

**Estado.** Fase A implementada en `feat/crm-multidispositivo` (commits T0 `60027a4`, T3 `94888c7`, T2 `90c905e`, T3.5 `071b354`), verificada en local (T6a.1, T6a.2) y documentada. Sin PR todavía. Documentación de T6a commiteada el 9/11.

**Siguiente sesión.**
1. ~~Commit de la documentación de T6a~~ (hecho 9/11).
2. T6a.3: el usuario prueba el preview de la rama en iPad Pro 13 (Safari) y Surface Pro 10 (Edge): botones de icono, interruptores, scroll de tablas y pestañas con el dedo, sin zoom en campos, pie del menú visible.
3. PR única de la Fase A a `main` (CI, merge por el usuario, sincronizar rama). Reactivar Vercel Authentication en `medi-renova-api` si se desea.
4. Decidir D0 (tablets 10–11" en vertical). Si sí: Fase B empezando por T1 Shell (raíl + cajón), en la misma rama o en `feat/crm-multidispositivo-b`.

**Incidencias anotadas, fuera de este change.**
- Sesión: el access token dura 15 min y al recargar la web vuelve al login en vez de renovar con el refresh token (visto en local de forma consistente). Revisar `apps/web/src/lib/auth-context.tsx` / `api.ts`.
- Carpeta temporal `.claude/worktrees/tmp-main-t6a` (build de `main` para T6a.2): borrada el 8/11 tras apagar los servidores de desarrollo.
