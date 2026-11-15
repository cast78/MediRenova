# Planes Esencial y Pro: manual de operación

Para quien gestiona el **panel de proveedor** (rol superadmin). Explica qué incluye cada plan, cómo se da de alta una clínica, cómo se asigna el plan o una prueba, cómo se atienden las peticiones y cómo se factura. Las rutas de pantalla van en cursiva; el código solo cuando hace falta saber dónde está la verdad.

## 1. Qué incluye cada plan

Hay dos planes: **Esencial** y **Pro**. Esencial es la operación del centro de reconocimiento; Pro añade la gestión comercial y la automatización. El catálogo vive en `apps/api/src/lib/plan.ts` (`FEATURES`) y es la única fuente: el menú, la API, la tarjeta "Tu plan" y la ficha de empresa lo leen de ahí.

| Función | Esencial | Pro |
|---|---|---|
| Agenda, visitas, consulta, reconocimientos y certificados | ✓ | ✓ |
| Clientes, historial y RGPD | ✓ | ✓ |
| Portal del paciente: certificados | ✓ | ✓ |
| KPIs operativos (dashboard) | ✓ | ✓ |
| Portal del paciente: citas y renovación | | ✓ |
| Analítica avanzada (embudo, fugas, detalle) | | ✓ |
| Captación (efectividad de campañas) | | ✓ |
| Avisos automáticos y Comunicaciones | | ✓ |
| Recuperación de no-shows | | ✓ |
| Campañas y segmentos | | ✓ |
| Renovación automática (workflow) | | ✓ |
| Reserva pública y auto-reserva por enlace | | ✓ |
| API e integraciones | | ✓ |
| Canales de mensajería (WhatsApp, email, SMS) | | ✓ |

Algunas funciones dependen de otras: Captación necesita Campañas; Renovación automática necesita Reserva pública; Canales necesita Avisos automáticos; Portal completo necesita Portal de certificados. Al activar una por excepción se arrastran sus dependencias, y al quitar una se quitan las que dependen de ella.

**Qué ve una clínica Esencial cuando una función es Pro**
- En el menú lateral, el módulo aparece con un candado; al entrar, una pantalla explica qué aporta y ofrece pedir el plan Pro.
- La API responde `403 FEATURE_NOT_IN_PLAN` a cualquier llamada de ese módulo, también desde integraciones. En la aplicación ese 403 se muestra como un aviso en la esquina ("Función del plan Pro", con el nombre de la función y el enlace "Ver mi plan"), y el menú vuelve a leer el plan por si el bloqueo viene de un cambio reciente.
- Los avisos automáticos a pacientes no se generan (no queda rastro en la bandeja de Comunicaciones, que es un módulo Pro); recepción puede seguir llamando o escribiendo a mano con los botones de siempre, que generan sus enlaces aparte.
- El portal del paciente solo muestra certificados.
- Los datos no se tocan: campañas, reglas de renovación o analítica histórica siguen guardados y vuelven a verse al pasar a Pro.

## 2. Alta de una clínica

*Panel de proveedor → Empresas → "Nueva empresa"*.

Campos: nombre comercial, identificador (código corto en minúsculas, único, se usa en URLs y en el acceso), zona horaria (Europe/Madrid o Atlantic/Canary), plan inicial, prueba Pro en días (opcional, solo si el plan es Esencial), límite de centros (vacío = sin límite) y el administrador: email, nombre, apellidos y contraseña inicial.

Al guardar se crea la empresa, el usuario administrador y una entrada de auditoría de alta. La empresa nace sin centros: el administrador entra con su email y la contraseña que le indiques, crea el primer centro y sus salas desde *Centros* y al resto del personal desde *Configuración → Equipo*. El email de acceso se guarda siempre en minúsculas.

## 3. Plan contratado, plan efectivo y prueba

- **Plan contratado**: el que la clínica paga. Es lo que muestra el panel de proveedor en todas partes (lista, tarjeta lateral, cabecera de la ficha, contador "Empresas").
- **Plan efectivo**: el que la clínica puede usar hoy. Coincide con el contratado salvo durante una **prueba Pro**, en la que una clínica Esencial usa Pro hasta la fecha indicada. La clínica ve el efectivo en su chip "Tu plan", con la nota "(plan contratado: Esencial)".
- **Prueba Pro**: solo tiene sentido con plan contratado Esencial; con Pro no se ofrece. Se fija con los atajos de 14, 30 o 60 días o con una fecha concreta. Al vencer, la vuelta a Esencial es automática y no borra nada. Una clínica solo puede disfrutar una prueba aprobada; después, para seguir en Pro, se contrata.

*Dónde se cambia*: en la ficha de empresa (*Empresas → Ficha → Licencia*) con "Guardar", indicando el motivo, que queda en la auditoría; o con las **acciones rápidas** de la tarjeta lateral del panel (Prueba 14/30/60 d, +14, +30, Quitar, Cambiar a Esencial…, Pasar a Pro…), que aplican el cambio al instante tras una confirmación. En la ficha, si quitas una prueba en curso aparece un aviso antes de guardar.

**Excepciones por función** (*Ficha → Licencia → Ajustes avanzados*): activar una función Pro concreta a una clínica Esencial, o quitarle una, sin cambiar de plan. Útil para acuerdos puntuales. Se validan las dependencias al guardar.

### Avisos de vencimiento de la prueba

Un proceso diario (07:30, hora de Madrid) revisa las pruebas en curso:
- A **7 días** y a **1 día** del fin: email al administrador de la clínica (con enlace a "Tu plan" para pedir quedarse en Pro) y email al proveedor.
- **Al vencer**: entrada de auditoría "Fin de la prueba Pro → Esencial · automático", y email a ambos.

Cada aviso deja constancia en *Ficha → Últimos cambios* y en la pestaña Auditoría, y esa constancia evita que se repita. Los emails salen de verdad solo si el servidor tiene configurado el proveedor de correo (`RESEND_API_KEY` y `EMAIL_FROM`); sin él, quedan registrados en el servidor en modo demo.

## 4. Peticiones de la clínica

La clínica no activa nada por sí misma: todo pasa por una petición que el proveedor aprueba o rechaza. Las hace el administrador desde *Configuración → Empresa → "Tu plan"* (y el centro adicional también desde *Centros*).

| Petición | Quién la ve | Qué hace al aprobarla |
|---|---|---|
| **Probar Pro 14 días** | Esencial, sin prueba en curso y sin prueba anterior aprobada | Fija una prueba de 14 días |
| **Quiero pasar a Pro** (en prueba: "Quedarme en Pro") | Esencial | Abre el diálogo de cambio a Pro (con motivo) |
| **Centro adicional** | Cualquier plan, al llegar al límite de centros | Sube el límite de centros en uno |

Reglas:
- **Una petición abierta por tipo.** La de centro adicional es independiente de las de plan, porque los centros no dependen del plan. Prueba y paso a Pro son excluyentes entre sí: una sola de las dos a la vez.
- Mientras una petición está abierta, su botón se sustituye por el estado "pendiente de aprobación".
- El proveedor recibe un email por cada petición y las ve en *Empresas → Peticiones abiertas* (también en la ficha de cada empresa, todas las que tenga).
- **Aprobar** aplica el cambio. **Rechazar** exige un motivo, que la clínica ve durante 30 días bajo el botón correspondiente ("Tu petición de … no fue aprobada por: …"). **Cerrar** (solo paso a Pro) la retira sin cambiar el plan y sin avisar a la clínica: para cuando se ha atendido por otra vía.
- Un rechazo no consume la prueba: la clínica puede volver a pedirla.

Colores en todo el sistema: azul para pasar a Pro, ámbar para la prueba, lila para centro adicional, verde para Esencial.

## 5. Centros y facturación

Cada empresa tiene un **límite de centros** (vacío = sin límite). Al alcanzarlo, *Centros → "Nuevo centro"* se desactiva y aparece "Solicitar un centro más", que genera la petición de centro adicional. La API devuelve `409 MAX_CENTERS_REACHED` si se intenta crear uno de más.

La facturación es **plan × centros contratados**: una clínica Esencial con tres centros y una Pro con uno son combinaciones normales. El diálogo de cambio de plan muestra siempre esa cuenta ("plan Pro × 2 centros") antes de confirmar. No hay cobro automático: el cambio lo hace el proveedor y la factura se gestiona fuera de la aplicación (anotado como idea futura: autoservicio con Stripe).

## 6. Herramientas del proveedor

- **Entrar como esta empresa**: abre la aplicación como si fueras el administrador de esa clínica, con una barra superior que lo recuerda y permite volver al panel. Sirve para dar soporte; todo lo que hagas queda auditado con tu usuario.
- **Ver como Pro**: desde esa barra, en una clínica Esencial, muestra todo abierto para enseñar el plan Pro. Es solo una vista previa: no guarda nada y la clínica nunca ve esa opción.
- **Empresa activa / inactiva**: la casilla de la ficha marca la empresa como suspendida en el panel (chip "Suspendida") sin borrar nada. Es una marca administrativa, útil en demos: **no bloquea por sí sola el acceso** de sus usuarios; si hace falta cortar el acceso, se desactivan los usuarios desde *Entrar como → Equipo*.

## 7. Panel de Empresas: qué significa cada cosa

- **Tarjetas superiores**: empresas por plan contratado, peticiones abiertas (por tipo), empresas en prueba (y cuántas vencen en 7 días), candidatas a Pro (≥ 5 no-shows o ≥ 80 citas en 30 días: argumento de venta, la recuperación automática), sin actividad (30 días sin citas) y centros contratados en total.
- **Columna "Atención"**: orden de prioridad: petición abierta, prueba que vence en 7 días, candidata a Pro, sin actividad, en prueba; "Al día" (verde) cuando no hay nada.
- **Tarjeta lateral**: resumen de la empresa seleccionada (qué ha pedido, actividad, citas por mes) y acciones rápidas. El nombre de la empresa en la tabla abre su ficha.
- **Ficha de empresa** (cabecera con plan, prueba, peticiones abiertas y "Entrar como esta empresa"; pestañas con contador):
  - *Licencia*: cambio de plan, límite de centros, prueba Pro y excepciones; al lado, el último cambio registrado, la actividad resumida y las peticiones abiertas con sus acciones.
  - *Actividad*: citas y no-shows de 30 días (con el periodo anterior y el porcentaje), última actividad, lectura comercial (candidata a Pro o plan Pro en uso), citas por mes de los últimos 12 meses con el tramo de no-shows, umbrales y argumento de venta.
  - *Usuarios*: equipo de la clínica con rol, estado, fecha de alta y último acceso (fecha de su última sesión); se edita desde la propia clínica (*Entrar como → Configuración → Equipo*).
  - *Centros*: centros contratados frente al límite, petición de centro adicional con "Aprobar" y "Rechazar", y una tarjeta por centro (salas, citas registradas en 30 días, alta); las plazas libres o el límite alcanzado se muestran como tarjetas punteadas.
  - *Auditoría*: línea de tiempo por día de los cambios de licencia y de las peticiones (con su estado), con filtros Plan · Prueba · Centros · Peticiones · Automático; las entradas del proceso diario van marcadas como "Automático".

## 8. Dónde está cada cosa en el código

- Catálogo y reglas de plan: `apps/api/src/lib/plan.ts` (`FEATURES`, `effectivePlan`, `features`).
- Guardas de módulo (403) y caché del plan: `apps/api/src/lib/plan-guards.ts`, `lib/authorization.ts`.
- Peticiones y "Tu plan": `apps/api/src/routes/tenants.ts`; panel de proveedor: `routes/superadmin.ts`.
- Vencimiento de pruebas: `apps/api/src/lib/trial-expiry.ts` (registrado en `lib/workflow-cron.ts`).
- Web: tarjeta "Tu plan" (`components/plan-card.tsx`, `self-trial-button.tsx`, `center-request-button.tsx`), panel (`app/superadmin/empresas`), chip de plan (`components/plan-chip.tsx`).
