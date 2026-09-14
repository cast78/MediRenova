# PRD — Portal del paciente ("Mi área")

## Why

Hoy el paciente **depende del centro** para todo lo que es suyo: si pierde el certificado del reconocimiento, llama; si no recuerda cuándo caduca su carnet, llama; si quiere ver su próxima cita, llama. Toda esa información **ya existe** en el CRM (revisiones con PDF, citas, caducidades), pero **no hay ninguna vía para que el propio paciente la consulte**.

Un **portal del paciente** —un área privada, sin necesidad de crear cuenta— resuelve esto y sube el CRM de categoría:

- **Autoservicio 24/7**: el paciente descarga su **certificado** y consulta su **historial** cuando quiera, sin llamar.
- **Menos carga operativa**: recepción deja de reenviar PDFs y de responder "¿cuándo caduca?".
- **RGPD por diseño**: es el **derecho de acceso** del interesado a sus datos, servido de forma controlada y auditada (no un email suelto con un adjunto).
- **Profesionalidad y confianza**: una marca de centro moderno; el paciente percibe control sobre sus datos.
- **Abre puertas**: reserva de renovación self-service, recordatorios accionables, y en el futuro pagos o valoraciones.

## What Changes

- **Nuevo "Portal del paciente"** (área pública, por centro, mobile-first), **separado** del panel del staff, con **acceso sin contraseña** (enlace mágico al contacto que ya consta en ficha + verificación de identidad ligera).
- **MVP (solo lectura):**
  - **Mis reconocimientos**: lista de las revisiones del paciente (producto, fecha, **APTO/NO APTO**, **caducidad**) con **descarga del PDF** del certificado.
  - **Mis citas**: próximas e historial (fecha, centro, estado).
- **Seguridad y aislamiento**: token de sesión de portal acotado a *un cliente + un centro*, con **filtro obligatorio por `customerId`** en cada consulta, descarga de PDF verificada contra el dueño, auditoría de accesos y rate-limit anti-enumeración en la solicitud de enlace.
- **Fase 2 (posibilidades, fuera del MVP):** reservar renovación desde el portal, reprogramar/cancelar la propia cita, preferencias de aviso, pago online.

## User journeys (MVP)

1. **Perdí mi certificado.** El paciente entra en `mi-area` del centro → introduce DNI + fecha de nacimiento → recibe un **enlace** en su email/SMS de ficha → abre su área → **descarga el PDF**. Cero llamadas.
2. **¿Cuándo caduca mi carnet?** Entra a su área → ve la **caducidad** de su último APTO → (fase 2) botón "reservar renovación".
3. **Tras el reconocimiento.** El centro envía "Tu certificado está listo — accede a tu área" → el paciente entra y descarga.
4. **Consultar mi próxima cita.** Entra a su área → ve la cita (fecha, centro, estado) y su historial.

## Capabilities

### New Capabilities

- `crm-portal-paciente`: área privada del paciente (sin cuenta) para **ver y descargar sus reconocimientos** y **consultar su historial de citas**, con acceso por enlace mágico + verificación de identidad, aislada por cliente y auditada.

### Modified Capabilities

- `revisions`: se añade una **vía de descarga del PDF para el paciente** (endpoint de portal que verifica que la revisión es suya), reutilizando `ensureRevisionPdf`.
- `magic-link` / auth: se añade un **tipo de token de portal** (multi-recurso, `type: "portal"`, `cid`+`tid`) y un **flujo de solicitud de acceso iniciado por el paciente** (hoy los enlaces solo los emite el staff).

## Impact

- **Backend**: nuevo grupo de rutas de portal (exentas del auth de staff, como `/link/*`), token de sesión de portal, endpoints "mis revisiones / mis citas / descargar mi PDF" con **scoping obligatorio por `customerId`**, endpoint de "solicitar enlace" con verificación de identidad + rate-limit anti-enumeración, y auditoría de accesos.
- **Frontend**: nuevo segmento público `app/mi-area/**` con layout ligero propio (branding del centro), sin el chrome del panel de staff; vistas de reconocimientos e historial; mobile-first.
- **Almacenamiento**: para producción, el **adaptador R2 + URLs firmadas** (hoy solo `LocalStorage`; la interfaz `Storage` ya lo contempla).
- **Sin cambios de modelo obligatorios** en el MVP (se filtra por `customerId`, ya indexado). Opcional: un identificador público/opaco de cliente si no se quiere depender solo del token.
- **Seguridad**: ver `design.md` — nota crítica: la **RLS de Postgres está definida pero inerte** en runtime; el aislamiento efectivo es a nivel de aplicación (extensión Prisma + `where` explícitos), por lo que el filtro por `customerId` es **imprescindible**.
- **Fases**: se implementa por fases (ver `tasks.md`): primero acceso + reconocimientos + historial (solo lectura); luego self-service (reservar/reprogramar) y R2/firmadas si no está antes.
