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

- [ ] T2.1 `components/ui/data-table.tsx`: scroll propio con fundido, primera columna fija, `priority` por columna, fila pulsable, menú "⋯" por fila en táctil
- [ ] T2.2 Migrar las 13 tablas (clientes, visitas, revisiones, médicos, equipo, productos, formularios, campañas, deliveries, utilización, empresas, ficha de empresa, auditoría)
- [ ] T2.3 Clientes: vista en tarjetas en `< lg` con conmutador recordado (según D2; Fase B)

## T3. Táctil

- [ ] T3.1 Alturas y tamaños de icono bajo `touch:` en botones, chips, pestañas e iconos de acción
- [ ] T3.2 Sustituir acciones solo-hover por `hover-none:opacity-100` (analítica, reservas, clientes, revisiones, consulta, visitas, utilización)
- [ ] T3.3 `components/ui/tabs-scroller.tsx` (scroll-snap, fundido, activa a la vista) y aplicarlo a Reservas, Analítica, Captación, Configuración, Revisiones y ficha de empresa
- [ ] T3.4 Tooltips como único canal → etiqueta visible o popover al tocar

## T6a. Verificación de la Fase A

- [ ] T6a.1 Script: objetivos táctiles ≥ 44 px y ninguna acción solo-hover, con `pointer: coarse` emulado a 1180×820 y 1376×1032
- [ ] T6a.2 Capturas antes/después en escritorio con ratón (1280/1440) sin diferencias
- [ ] T6a.3 Prueba en iPad Pro 13 y Surface Pro 10 reales: pulsación, zoom en inputs, scroll de tablas con el dedo
- [ ] T6a.4 `docs/multidispositivo.md`: dispositivos soportados (declaración "tablet de 11" o más, en horizontal" mientras no haya Fase B)

# Fase B — Disposición compacta (solo si D0 = sí)

## T1. Shell

- [ ] T1.1 `app-layout.tsx`: raíl de 64 px por debajo de `lg` (logo, iconos con badge y candado, avatar); menú completo a partir de `lg`
- [ ] T1.2 Cajón (280 px, overlay, cierre al tocar fuera o navegar) con secciones, etiquetas, "Tu plan", usuario y cerrar sesión
- [ ] T1.3 `context-bar.tsx` compacta: botón ☰, nombre truncado, selector de centro
- [ ] T1.4 `SuperadminBar` a una línea en `< lg`; modo proveedor con raíl
- [ ] T1.5 Verificar en 768/820/1024/1180 y en escritorio sin cambios

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
