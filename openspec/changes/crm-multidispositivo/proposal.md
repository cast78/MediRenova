## Why

MediRenova se diseñó para pantalla de escritorio. Revisada a 768 px (tablet en vertical) con el admin de la demo, **no se rompe pero no está pensada para tablet**: el menú lateral fijo de 224 px deja 544 px al contenido, las tablas cortan columnas (Clientes trunca el teléfono), la fila de pestañas de Reservas se recorta, la vista Semana queda comprimida, y hay acciones que solo aparecen al pasar el ratón, iconos de 16 px y controles de 28–34 px de alto que no se pulsan bien con el dedo. En horizontal (≥ 1024 px) la app es, a efectos prácticos, la de escritorio.

La aplicación debe ser **multidispositivo**: cualquier perfil (recepción, médico, admin, proveedor) puede trabajar en tablet o en ordenador indistintamente, y la experiencia debe ser la misma app con las mismas rutas y funciones, adaptada a la anchura y al dedo.

## Decisión de alcance (14/10/2026)

En producción la app ya se ve como en escritorio en **iPad Pro 13" (1376×1032, ambas orientaciones)** y **Surface Pro 10 (1440×960 apaisada)**, porque ambas superan los 1024 px CSS. La adaptación por anchura solo hace falta para **tablets de 10–11" en vertical** (iPad 10.9": 820 px → 596 px de contenido; Android 8–10": 768–800 px). Lo que sí afecta a todas las tablets es el **eje táctil** (controles de 28–34 px, acciones solo-hover, zoom de Safari en inputs < 16 px, iconos de 16 px, tooltips).

El change se parte en dos fases:

- **Fase A — Táctil y tablas (obligatoria)**: T0 + T2 + T3. Sin cambios de disposición; cubre al 100 % iPad Pro 13 y Surface Pro 10 y mejora el resto. Bajo riesgo.
- **Fase B — Disposición compacta (condicionada)**: T1 + T4 + T4b + T5. Solo si se decide soportar tablets de 10–11" en vertical. Mientras no se decida, el requisito comercial se declara como "tablet de 11" o más, en horizontal".

## What Changes

- **T0 Fundamentos**: variante Tailwind `touch` (`pointer: coarse`), reglas globales de tamaño mínimo táctil (44 px) y de tipografía en inputs (16 px, evita el zoom de iOS), `viewport-fit=cover`, convención de breakpoints (`lg` = frontera tablet/escritorio).
- **T1 Shell**: por debajo de `lg` el menú lateral pasa a **raíl de iconos** (64 px) con un **cajón** desplegable sobre el contenido; barra de contexto compacta; "Tu plan", usuario y cerrar sesión viven en el cajón; barra del superadmin a una línea.
- **T2 Tablas y listas**: patrón único `DataTable` (scroll horizontal propio, primera columna fija, columnas con prioridad que se ocultan en tablet, fila completa pulsable); Clientes con alternativa en tarjetas.
- **T3 Táctil**: altura mínima en botones, inputs, filas y pestañas; acciones de hover siempre visibles en pantalla táctil; pestañas con desplazamiento y fundido en los bordes; sin tooltips como único canal de información.
- **T4 Reservas**: pestañas desplazables, Semana compacta (columnas estrechas con desplazamiento lateral y ajuste por día), Día como vista por defecto en tablet (recordada), "Nueva reserva" y detalle como hoja a pantalla completa.
- **T5 Modales y formularios**: componente `Modal` con modo **hoja** (`sheet`) por debajo de `lg` (pantalla completa, cabecera y pie fijos); consulta y ficha de cliente a una columna; la firma ya es táctil.
- **T6 Verificación**: matriz de dispositivos (768×1024, 820×1180, 1024×768, 1180×820) revisada página a página, sin desbordamiento horizontal, y documentación `docs/multidispositivo.md`.

**No-goals**
- Móvil (< 768 px) para el panel de gestión: queda para una fase posterior (portal del paciente, reserva pública y confirmación ya son móviles).
- App nativa, modo sin conexión o notificaciones push.
- Rediseño visual: se conserva la identidad actual; solo cambia la disposición y el tamaño de los controles.

## Capabilities

### New Capabilities

- `crm-multidispositivo`: la aplicación de gestión se adapta a tablet (vertical y horizontal) y a entrada táctil sin perder funciones ni cambiar de rutas: shell compacto, tablas legibles, controles de tamaño táctil, reservas y formularios usables con el dedo.

### Modified Capabilities

- `dashboard`, `appointments`, `customers`, `revisions`, `crm-dashboards`, `crm-analitica`, `form-builder`, `crm-planes` (panel de proveedor): únicamente disposición y controles; el comportamiento y la API no cambian.

## Impact

- **Solo frontend** (`apps/web`): `app-layout.tsx`, `context-bar.tsx`, `globals.css`, `tailwind.config`, nuevos componentes `ui/modal`, `ui/data-table`, `ui/tabs-scroller`, y retoques por página (13 tablas, 21 modales, 7 páginas con acciones de hover, 36 grids sin breakpoint).
- **Sin cambios en API ni modelo.** Cada fase es desplegable por separado y no altera la vista de escritorio (todo se activa por debajo de `lg` o con puntero táctil).
- **Riesgo controlado**: las reglas globales táctiles (T0) afectan a toda la app en dispositivos con dedo; se validan en una tablet real antes de mergear.
