# MediRenova en tablet y pantalla táctil

Borrador (crm-multidispositivo, Fase A). Se completa al cerrar cada fase.

## Dispositivos soportados

| Dispositivo | Orientación | Soporte |
|---|---|---|
| Ordenador (≥ 1024 px) | — | completo (vista de escritorio) |
| Tablet de 11" o más (iPad Pro 11/13, iPad Air, Surface Pro) | horizontal | completo: vista de escritorio con controles táctiles |
| iPad Pro 13" | vertical | completo (1032 px CSS, recibe la vista de escritorio) |
| Tablet de 10–11" | vertical | **usable sin garantía de disposición** hasta la Fase B (menú de 224 px fijo, tablas con scroll) |
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

## Cómo probar

1. **Emulación**: en las herramientas del navegador, modo dispositivo con un iPad (apaisado 1180×820 o 1376×1032) y puntero táctil activado. Comprobar: botones y campos ≥ 44 px, sin zoom al enfocar un campo, acciones de fila visibles sin hover, tablas con scroll lateral propio y la página sin scroll horizontal.
2. **Preview de Vercel**: cada push a la rama genera una URL de preview; abrirla en el iPad o la Surface reales (misma API y datos que producción; este cambio no toca la API).
3. **Escritorio con ratón**: nada debe cambiar. Comparar capturas a 1440 px antes y después.

## Pendiente

- Fase A: T2 (`DataTable` en las 13 tablas) y T3 (alturas por componente, hover visible, `TabsScroller`, tooltips).
- Fase B (si se decide soportar tablets de 10–11" en vertical): raíl y cajón, hojas a pantalla completa, Semana compacta, filtros de analítica en hoja, formularios a una columna.
