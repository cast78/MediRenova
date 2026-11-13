# MediRenova en tablet y pantalla táctil

Estado: **Fase A en producción** (táctil y tablas; `crm-multidispositivo`, PR #22). **Fase B en curso** (disposición compacta para tablets de 10–11" en vertical): T1 Shell, T5 diálogos y T4 Reservas hechos; falta T4b Analítica/Captación.

## Dispositivos soportados

| Dispositivo | Orientación | Soporte |
|---|---|---|
| Ordenador (≥ 1024 px) | — | completo (vista de escritorio) |
| Tablet de 11" o más (iPad Pro 11/13, iPad Air, Surface Pro) | horizontal | completo: vista de escritorio con controles táctiles |
| iPad Pro 13" | vertical | completo (1032 px CSS, recibe la vista de escritorio) |
| Tablet de 10–11" | vertical | **en curso (Fase B)**: menú en raíl de 64 px con cajón, diálogos como hoja a pantalla completa, Reservas con Día por defecto y Semana desplazable; faltan los filtros de analítica |
| Teléfono | — | solo las páginas públicas (reserva, confirmación, portal del paciente) |

La frontera entre disposición compacta y de escritorio es el breakpoint `lg` de Tailwind (1024 px CSS). Los píxeles CSS no son los físicos: un iPad Pro 13" apaisado mide 1376 px CSS; una Surface Pro 10 al 200 %, 1440 px.

## Dos ejes, no uno

- **Anchura** decide qué cabe (breakpoints `md` 768 / `lg` 1024 / `xl` 1280).
- **Puntero** decide cómo se pulsa: `pointer: coarse` (dedo) frente a `pointer: fine` (ratón). Un iPad apaisado es `lg` *y* táctil a la vez. Nunca se infiere uno del otro.

## Convenciones de código (Fase A)

- Variantes Tailwind `touch:` (`pointer: coarse`) y `hover-none:` (`hover: none`), definidas en `tailwind.config.mjs`.
- `globals.css` aplica bajo `pointer: coarse`: altura mínima de 44 px en botones, pestañas, selects, campos y áreas de texto; checkboxes y radios de 20 px; sin resalte azul de iOS al tocar. Un control concreto se excluye con la clase `touch-exempt`. El texto de 16 px en campos (evita el zoom de Safari al enfocar) se aplica **solo en teléfonos** (táctil y < 768 px): en iPad y Windows ese zoom no existe y las tablets mantienen 14 px.
- Botones de solo icono (`<button><Icon/></button>`): en táctil miden al menos 44×44 px con icono de 20 px, por una regla global (`button:has(> svg:only-child)`). No hace falta tocar el componente; si uno debe quedar pequeño, `touch-exempt`.
- Interruptores (toggles): siempre `role="switch"` + `aria-checked`. Conservan su tamaño visual (la regla de 44 px no los estira) y ganan el objetivo táctil con un área invisible alrededor (`[role="switch"]::before`); el botón debe ser `relative`.
- Una acción que en escritorio aparece al pasar el ratón (`opacity-0 group-hover:opacity-100`) lleva además `hover-none:opacity-100` para que en táctil sea visible siempre.
- Un tooltip (`title`) nunca es el único canal de una información: va acompañado de etiqueta visible (p. ej. `<span className="hidden touch:inline">Editar</span>`) o se abre al tocar.
- Filas de pestañas: siempre con `<TabsScroller variant="pills" | "underline">` (`components/ui/tabs-scroller.tsx`) y pestañas con `role="tab"` y `aria-selected`. En escritorio se ve igual; si no cabe, se desplaza en horizontal con fundido en los bordes y trae la activa a la vista. Las pestañas obtienen los 44 px táctiles por `[role="tab"]`.
- El contenedor principal usa `h-dvh`, no `h-screen` (en Safari de iPad `100vh` incluye la barra del navegador).
- `viewport` con `viewport-fit=cover` en `app/layout.tsx`.
- Tablas: siempre envueltas en `<DataTable minWidth={N}>` (`components/ui/data-table.tsx`), que da scroll horizontal propio con fundido, ancho mínimo, primera columna fija al desplazar y filas más altas en táctil, sin tocar el marcado de la tabla. Columnas prescindibles con `hidden lg:table-cell` en `th` y `td` (solo se ocultan por debajo de 1024 px).

## Convenciones de código (Fase B)

- **Shell** (`components/app-layout.tsx`): por debajo de `lg` el menú es un raíl de 64 px (iconos de 48 px, badge, candado, avatar) y el menú completo vive en un cajón de 280 px (`role="dialog"`) que se abre desde ☰, el logo o el avatar y se cierra al navegar, al tocar fuera, con Escape o al pasar a escritorio. El aside de 224 px de escritorio es el mismo marcado de siempre con `hidden lg:flex`. Las piezas (marca, navegación, pie de usuario) se comparten entre aside y cajón.
- **Barras superiores** (`context-bar.tsx`, `SuperadminBar`, barra de proveedor): `px-3 lg:px-6`, botón ☰ `lg:hidden`, textos largos a `title` con versión corta `lg:hidden`, nombres con `truncate`.
- **Diálogos**: siempre `<Modal>` (`components/ui/modal.tsx`), nunca un `fixed inset-0` a mano. En escritorio es el diálogo centrado (`size` xs–5xl). Por debajo de `lg`, los de tamaño lg o más son **hoja a pantalla completa**; los pequeños (confirmaciones) siguen centrados; se fuerza con `sheet`. Dos formas de tener cabecera y pie fijos en la hoja: pasar `title` y `footer` al `Modal` (el botón de enviar va en el pie, fuera del `<form>`, asociado con `form="id"`), o dejar el contenido como está y marcar la fila del título con `sheet-head` y la de acciones con `sheet-foot` (clases de `globals.css`, pegajosas dentro del cuerpo con scroll, solo activas por debajo de `lg`). El cuerpo de una hoja lleva 1 rem de relleno, que esas clases compensan. Cierre por fondo, X y Escape; `locked` lo desactiva mientras se guarda.
- **Variantes `max-lg:`**: no están disponibles porque `screens` incluye pantallas `raw` (`touch`, `hover-none`); lo que deba aplicarse solo por debajo de `lg` va en `globals.css` bajo `@media (max-width: 1023.98px)` o se expresa en positivo (`grid-cols-1 lg:grid-cols-2`).
- **Rejillas**: las de 2 columnas caben en tablet vertical; las filas de 3–4 indicadores pasan a `grid-cols-2 lg:grid-cols-4`; editores a dos paneles, a una columna bajo `lg`.
- **Reservas en tablet vertical**: se abre en la última vista usada en el dispositivo (por defecto Día); la Semana es un calendario con scroll propio en los dos ejes: 7 columnas de 160 px (`.wk-days` en `globals.css`) con ajuste por día, cabecera de días y columna de horas pegajosas dentro del contenedor, alto limitado al disponible en pantalla y posición inicial en lunes y la hora actual; la leyenda de estados se pliega tras "Leyenda ▾" (`StatusLegend`).
- **Selectores**: `<Select>` (`components/ui/select.tsx`) en lugar del `<select>` nativo (el picker del sistema varía por dispositivo y agrupa mal): botón con la opción elegida; desplegable propio en escritorio y hoja centrada por debajo de `lg`; opciones planas o agrupadas con etiqueta, punto de color e indicación secundaria opcionales; `emptyLabel` para un vacío elegible ("Todas las salas"). `RoomSelect` es un envoltorio suyo (salas agrupadas por centro solo cuando hay varios). Los `<select>` que queden se migran al tocar cada pantalla.

## Cómo probar

1. **Emulación**: en las herramientas del navegador, modo dispositivo con un iPad (apaisado 1180×820 o 1376×1032) y puntero táctil activado. Comprobar: botones y campos ≥ 44 px, sin zoom al enfocar un campo, acciones de fila visibles sin hover, tablas con scroll lateral propio y la página sin scroll horizontal.
2. **Preview de Vercel**: cada push a la rama genera una URL de preview; abrirla en el iPad o la Surface reales (misma API y datos que producción; este cambio no toca la API).
3. **Escritorio con ratón**: nada debe cambiar. Comparar capturas a 1440 px antes y después.

## Verificación realizada (Fase A, 8/11/2026)

- **Táctil emulado**, 15 páginas (dashboard, reservas mes/día, visitas, revisiones, clientes, analítica, campañas, workflow, centros, productos, formularios, médicos, equipo, configuración): 0 controles por debajo de 44 px (excluidos interruptores, que tienen área de pulsación propia), 0 acciones solo-hover, 0 desbordamientos horizontales de página, 16 de 16 tablas dentro de `DataTable`.
- **Escritorio con ratón a 1440 px**: huella de tamaños de todos los botones, campos, selects y tablas de 7 páginas comparada entre `main` y la rama: idéntica.
- **Pendiente en dispositivo real** (iPad Pro 13 con Safari, Surface Pro 10 con Edge): pulsación de botones e interruptores, desplazamiento de tablas y pestañas con el dedo, que el teclado en pantalla no tape los campos, y que el pie del menú ("Cerrar sesión") quede visible en Safari.

## Pendiente

- Fase B (en curso): filtros de analítica en hoja (T4b); verificación final T6b.
- Vista en tarjetas para Clientes en tablet (T2.3, Fase B).
