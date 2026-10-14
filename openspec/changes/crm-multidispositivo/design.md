# Design — crm-multidispositivo (tablet y táctil)

## Punto de partida (inventario, 14/10/2026)

Revisión a 768×1024 con `admin@clinica-demo.es` e inventario de `apps/web/src`:

| Hecho | Dato |
|---|---|
| Ficheros `.tsx` en `app/` + `components/` | 70, de los que solo **20** usan algún breakpoint (`sm: md: lg:`) |
| Tablas | 13; **7 sin** `overflow-x-auto` (campañas, clientes, médicos, formularios, revisiones, equipo, ficha de empresa) |
| Modales | 21 con `fixed inset-0`, cada uno con su propio markup (no hay componente común) |
| Acciones solo-hover (`group-hover`, `opacity-0`) | 7 páginas: analítica, reservas, clientes, revisiones, consulta, visitas, utilización |
| Grids a 2+ columnas **sin** breakpoint | 36 |
| Controles bajos | 183 × `py-1.5`, 71 × `py-1`, 25 × `h-7/h-8` (≈ 28–34 px de alto) |
| Menú lateral | `aside w-56` fijo (224 px) en todas las anchuras |
| Desbordamiento horizontal de página | ninguno (la página no se desplaza lateralmente; el recorte ocurre dentro de tablas y pestañas) |
| Páginas públicas | reserva, confirmación y portal ya están a una columna (`max-w-md/lg`) |

Capturas de referencia (768 px): dashboard correcto; Reservas/Mes correcto salvo la fila de pestañas recortada; Semana comprimida; Clientes con la columna teléfono cortada; Configuración y Revisiones correctas.

## Dispositivos objetivo y breakpoints

Se usan los breakpoints por defecto de Tailwind; la frontera tablet/escritorio es **`lg` (1024 px)**.

| Clase | Anchura | Ejemplos | Disposición |
|---|---|---|---|
| Móvil | < 768 | teléfonos | fuera de alcance para el panel (fase posterior); público ya adaptado |
| Tablet vertical | 768–1023 | iPad 768/820, Android 800 | **compacta** (Fase B): raíl + cajón, hojas a pantalla completa, 1 columna |
| Tablet horizontal / escritorio | ≥ 1024 | iPad apaisado 1024/1180, portátil | **actual** (menú completo, 2 columnas) |

**Qué recibe cada tablet real hoy** (píxeles CSS, no físicos):

| Dispositivo | Apaisado | Vertical | Hoy |
|---|---|---|---|
| iPad Pro 13" | 1376 × 1032 | 1032 × 1376 | escritorio en ambas orientaciones |
| Surface Pro 10 (escala 200 %) | 1440 × 960 | 960 × 1440 | escritorio apaisado; en vertical menú de 224 px + 736 px de contenido, todavía legible |
| iPad 10.9" / Air | 1180 × 820 | 820 × 1180 | escritorio apaisado; **en vertical 596 px de contenido**: tablas cortadas, Semana ilegible |
| iPad mini / Android 8–10" | 1024–1080 × 768 | 768 × 1024 | lo visto en las capturas: funciona, estrecho |

## Dos fases

| Fase | Tareas | Cuándo | Riesgo |
|---|---|---|---|
| **A — Táctil y tablas** (obligatoria) | T0 + T2 + T3 | ahora; cubre iPad Pro 13 y Surface Pro 10 al completo | bajo: sin cambios de disposición, solo bajo `pointer: coarse` y dentro de tablas/pestañas |
| **B — Disposición compacta** (condicionada) | T1 + T4 + T4b + T5 | solo si se decide soportar tablets de 10–11" en vertical | medio: shell, modales y calendario cambian por debajo de `lg` |

Lo que la Fase A arregla y una captura no muestra: controles de 28–34 px (254 en el código) frente a los 44 px táctiles; acciones solo-hover en 7 páginas (en iPad el primer toque simula el hover y el segundo ejecuta, pero el usuario no sabe que están); inputs < 16 px que hacen zoom en Safari; iconos de 16 px como único objetivo; tooltips como único canal.

La **entrada táctil** se trata como eje independiente de la anchura: un iPad apaisado tiene 1180 px pero no tiene ratón. Se añaden las variantes Tailwind `touch:` → `@media (pointer: coarse)` y `hover-none:` → `@media (hover: none)`.

## Principios

1. **Una sola app**: mismas rutas, mismos componentes, mismas funciones. No existe un "modo tablet" ni se ocultan funciones; se reordenan.
2. **Dos ejes**: anchura (qué cabe) y puntero (cómo se pulsa). Nunca se infiere uno del otro.
3. **Mejora progresiva**: la vista de escritorio no cambia; todo lo nuevo actúa por debajo de `lg` o bajo `touch:`.
4. **Componentes comunes antes que retoques por página**: `Modal`, `DataTable` y `TabsScroller` concentran el 80 % del trabajo.
5. **Sin desbordamiento horizontal de página**: solo tablas y calendario pueden desplazarse lateralmente, cada uno dentro de su propio contenedor.

## T0. Fundamentos

- `tailwind.config`: `screens` por defecto + variantes `touch` (`pointer: coarse`) y `hover-none`.
- `globals.css` bajo `@media (pointer: coarse)`: `button, [role=button], input, select, textarea, [role=tab], tr[data-row] { min-height: 44px }`; `input, select, textarea { font-size: 16px }` (evita el zoom automático de iOS); `-webkit-tap-highlight-color: transparent`; `scroll-padding` en contenedores con pestañas.
- `app/layout.tsx`: `viewport` con `width=device-width, initial-scale=1, viewport-fit=cover`.
- Convención: nunca `w-[Npx]` por encima de 320 px sin alternativa; los `min-w-[520/560px]` existentes pasan a vivir dentro de `overflow-x-auto`.

## T1. Shell (app-layout + context-bar)

**Estados del menú**

| Anchura | Menú | Cabecera |
|---|---|---|
| ≥ lg | `aside` 224 px como hoy | ContextBar como hoy |
| < lg | **raíl** de 64 px: logo, iconos de módulos con badge, avatar abajo | ContextBar compacta: botón ☰ · nombre de empresa (truncado) · selector de centro |
| < lg, cajón abierto | **cajón** de 280 px sobre el contenido (overlay oscuro, cierre al tocar fuera o al navegar): menú completo con etiquetas y secciones, "Tu plan", usuario, cerrar sesión | — |

- Tocar un icono del raíl navega directamente; el cajón solo hace falta para ver etiquetas, plan, usuario o salir.
- El raíl marca el módulo activo con la barra lateral de color como hoy; el badge de Reservas se mantiene sobre el icono.
- Candados de módulos bloqueados (planes): icono con candado pequeño en el raíl; en el cajón, igual que hoy.
- `SuperadminBar` (modo empresa del superadmin) a una línea en `< lg`: chip de plan + "Volver" con icono; el texto largo pasa a `title`.
- Modo proveedor (`/superadmin/*`): el menú corto (Empresas · Peticiones) cabe en el raíl sin cambios; la lista de empresas usa `DataTable` (T2) y el panel lateral pasa a hoja (T5).

## T2. Tablas y listas — `DataTable`

Componente `components/ui/data-table.tsx` que envuelve las 13 tablas:

- Contenedor `overflow-x-auto` con `-webkit-overflow-scrolling: touch` y sombra de fundido en los bordes cuando hay más contenido.
- `columns[]` con `priority: 1 | 2 | 3`: en `< lg` se ocultan las de prioridad 3; en `< md` también las de 2. La primera columna (`sticky left-0`) siempre visible.
- Fila completa pulsable (`data-row`, `min-h-11` en táctil) cuando hay detalle; las acciones por fila pasan a un menú "⋯" al final de la fila en táctil (sustituye a las acciones de hover).
- Paginación/contador al pie como hoy.

**Clientes** (la tabla más usada en recepción): en `< lg` se ofrece además vista en **tarjetas** (nombre, DNI, teléfono con acción de llamar/WhatsApp, última cita) con un conmutador tabla/tarjetas recordado en `localStorage`. Decisión abierta D2.

## T3. Táctil

- Tamaño: botones primarios `h-11`, secundarios `h-10`, chips/pestañas `h-10`, iconos de acción `w-10 h-10` con icono de 20 px (hoy 16 px) bajo `touch:`.
- **Hover**: todo `opacity-0 group-hover:opacity-100` pasa a `hover-none:opacity-100` (visible siempre en táctil). Afecta a analítica, reservas, clientes, revisiones, consulta, visitas y utilización.
- **Tooltips** (`title`) no son el único canal: la información pasa a etiqueta visible o a un popover al tocar.
- **Pestañas** (`TabsScroller`): `overflow-x-auto` con `scroll-snap`, fundido en los bordes, pestaña activa desplazada a la vista al cargar.
- **Separación**: `gap-2` mínimo entre objetivos táctiles contiguos; en listas, `divide-y` con filas de 44 px.

## T4. Reservas

- Fila de vistas (Mes · Semana · Día · Agenda · Sin cerrar · Episodios · Recuperar) con `TabsScroller`.
- **Vista por defecto** en `< lg`: Día (recordada por dispositivo); en `≥ lg` sigue Mes.
- **Semana** en `< lg`: columnas de 160 px dentro de `overflow-x-auto` con `scroll-snap` por día; el día actual centrado al cargar; cabecera de días fija. Decisión abierta D3 (7 días desplazables vs 3 días visibles).
- **Mes**: celdas con puntos de estado como hoy; tocar un día abre Día.
- **Nueva reserva / detalle de cita**: hoja a pantalla completa (T5) con pie fijo (Guardar · Cancelar).
- Leyenda de estados plegable en `< lg` (hoy ocupa dos líneas).

## T5. Modales y formularios — `Modal`

Componente `components/ui/modal.tsx` que sustituye a los 21 `fixed inset-0`:

- `≥ lg`: diálogo centrado como hoy (`max-w-*` por uso).
- `< lg`: **hoja** (`sheet`): pantalla completa, cabecera fija (título + cerrar), cuerpo con scroll, **pie fijo** con las acciones (siempre alcanzables con el pulgar); cierre con el botón o deslizando hacia abajo (opcional).
- Formularios largos (consulta `revisions/[id]`, ficha de cliente, alta de empresa): `grid-cols-2` → `grid-cols-1 lg:grid-cols-2`; etiquetas encima de los campos; `SignaturePad` ya es táctil (se amplía a todo el ancho en `< lg`).
- `ConfirmDialog` y `PlanChangeDialog` heredan el modo hoja sin cambios de contenido.

## T4b. Analítica y Captación (`analitica/module.tsx`, compartido)

Las dos páginas usan el mismo `AnalyticsModule` (`mod="gestion" | "captacion"`), así que los cambios se hacen una vez. A 768 px lo que falla: el bloque de filtros ocupa un tercio de la pantalla (periodo + centro/médico/producto/sala en dos filas), las 7 pestañas se recortan, y las tablas de rendimiento por sala/médico, comparativas y campañas cortan columnas; el drill-down de fugas aparece al pasar el ratón.

- **Barra de filtros** en `< lg`: chips de periodo (30d · 90d · Año · Personalizar) + botón **"Filtros"** con contador de filtros activos + exportar como icono de 44 px; una línea de resumen ("90 días · Centro Madrid · Dr. Pérez"). Los selectores (periodo personalizado, centro, médico, sala, producto, ámbito del superadmin) se abren en una **hoja** (`Modal` en modo `sheet`) con "Quitar filtros" y "Aplicar". En `≥ lg` el bloque actual no cambia.
- **Pestañas** con `TabsScroller` (Analítica: 7; Captación: 3).
- **KPIs** a 2 columnas (ya) con la variación debajo; alertas como filas de 44 px.
- **Gráficas** (`recharts` + SVG propio) a todo el ancho, alto fijo 150–220 px; leyenda debajo.
- **"Dónde se pierde" / "Fugas del periodo"**: filas pulsables de 52 px con contador, porcentaje y chevron; el drill-down a clientes se abre al tocar (sustituye al hover).
- **Embudo**: barras apiladas a todo el ancho con la cifra dentro.
- **Tablas** (rendimiento por sala, médicos, comparativa entre centros/salas, efectividad de campañas, altas por canal): `DataTable` con primera columna fija y prioridades; tocar una campaña abre su detalle como hoja.
- **Captación · Resumen**: altas por canal como barras horizontales (legibles a 704 px); los accesos "Ver altas por canal" y "Ver efectividad de campañas" como tarjetas de 64 px.
- La página con candado (Esencial) ya es de una columna; sin cambios.

## Verificación (T6)

- Matriz: 768×1024 (iPad vertical), 820×1180 (iPad Air vertical), 1024×768 y 1180×820 (apaisado), con `pointer: coarse` emulado.
- Por página: sin desbordamiento horizontal (`scrollWidth ≤ innerWidth`), objetivos táctiles ≥ 44 px (script que mide `getBoundingClientRect` de botones e inputs), ninguna acción solo-hover.
- Escritorio (1280/1440) sin cambios visuales respecto a `main` (captura antes/después).
- `docs/multidispositivo.md`: dispositivos soportados, breakpoints, componentes comunes y cómo probar.

## Decisiones abiertas (a discutir antes de implementar)

- **D0 Soportar tablets de 10–11" en vertical** (decide si la Fase B se hace). Mientras no: requisito declarado "tablet de 11" o más, en horizontal". Decidido el 14/10/2026: Fase A sí; Fase B pendiente.
- **D1 Menú en tablet vertical**: raíl de iconos + cajón (propuesta) o solo cajón con ☰ (más contenido, un toque más por navegación).
- **D2 Clientes**: tabla con scroll y prioridades (propuesta mínima) o tarjetas como vista por defecto en tablet.
- **D3 Semana en tablet**: 7 días con desplazamiento lateral (propuesta) o 3 días visibles con flechas.
- **D4 "Añadir a pantalla de inicio"** (manifest + iconos, sin service worker): barato y útil en recepción; no es una PWA completa.
- **D5 Móvil**: fuera de alcance aquí; si se aborda, empezar por Agenda del día y ficha de cliente.

## Riesgos / notas

- Las reglas globales de T0 cambian alturas en todos los dispositivos táctiles de golpe: validar en un iPad real antes de mergear T0+T1.
- `Modal` y `DataTable` tocan muchas páginas: mergear por lotes pequeños (módulo a módulo), siempre con la vista de escritorio comparada.
- Los 36 grids sin breakpoint se revisan uno a uno; la mayoría son de 2 columnas y pasan a `grid-cols-1 md:grid-cols-2`.
- Safari iOS: `100vh` en hojas → usar `100dvh`; el teclado en pantalla reduce el alto y el pie fijo debe seguir visible.
