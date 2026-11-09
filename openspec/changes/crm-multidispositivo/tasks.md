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

- [ ] T4.1 Pestañas de vistas con `TabsScroller`; leyenda plegable en `< lg`
- [ ] T4.2 Vista por defecto Día en `< lg` (recordada por dispositivo)
- [ ] T4.3 Semana: columnas de 160 px con desplazamiento lateral y `scroll-snap`, cabecera fija, día actual centrado (según D3)
- [ ] T4.4 Nueva reserva y detalle de cita como hoja (T5)

## T4b. Analítica y Captación (módulo compartido)

- [ ] T4b.1 Barra de filtros compacta en `< lg` (periodo · "Filtros" con contador · exportar) con los selectores en hoja; sin cambios en `≥ lg`
- [ ] T4b.2 Pestañas con `TabsScroller` (7 en Analítica, 3 en Captación)
- [ ] T4b.3 "Dónde se pierde", "Fugas del periodo" y accesos del resumen de Captación como filas/tarjetas pulsables (sin hover)
- [ ] T4b.4 Tablas del módulo (salas, médicos, comparativas, campañas, altas por canal) con `DataTable`; detalle de campaña como hoja
- [ ] T4b.5 Gráficas a todo el ancho con alto fijo y leyenda debajo; embudo apilado

## T5. Modales y formularios

- [ ] T5.1 `components/ui/modal.tsx`: diálogo en `≥ lg`, hoja a pantalla completa en `< lg` (cabecera y pie fijos, `100dvh`)
- [ ] T5.2 Migrar los 21 modales (incluidos `ConfirmDialog`, `PlanChangeDialog`, nuevo cliente, walk-in, info de cliente, panel lateral de empresas)
- [ ] T5.3 Consulta (`revisions/[id]`), ficha de cliente y alta de empresa: una columna en `< lg`, firma a todo el ancho
- [ ] T5.4 Revisar los 36 grids sin breakpoint (`grid-cols-1 md:grid-cols-2`)

## T6b. Verificación de la Fase B

- [ ] T6b.1 Script por página (sin desbordamiento, objetivos ≥ 44 px, sin solo-hover) en 768×1024 · 820×1180 · 1024×768 · 1180×820
- [ ] T6b.2 Capturas antes/después en escritorio (1280/1440) sin diferencias
- [ ] T6b.3 Prueba en iPad 10.9" real (Safari) en vertical: teclado en pantalla con hojas, scroll de Semana
- [ ] T6b.4 `docs/multidispositivo.md` final (retirar la restricción "en horizontal")

## Decisiones pendientes (ver design.md)

- [x] D0 Fase A se hace; Fase B solo si se decide soportar tablets de 10–11" en vertical (pendiente)
- [ ] D1 Raíl + cajón vs solo cajón
- [ ] D2 Clientes: tabla con prioridades vs tarjetas por defecto en tablet
- [ ] D3 Semana: 7 días desplazables vs 3 días visibles
- [ ] D4 "Añadir a pantalla de inicio" (manifest) sí/no
- [ ] D5 Móvil en fase posterior: alcance mínimo (Agenda del día, ficha de cliente)

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
