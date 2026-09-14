## 1. Acceso y sesión de portal (backend)

- [x] 1.1 Token de portal: `signPortalToken({ cid, tid })` / `verifyPortalToken` (`type: "portal"`, 60 min) en `lib/jwt.ts`
- [x] 1.2 Exención de `/api/v1/portal/*` en `plugins/auth.ts`; `preHandler` `requirePortal` que valida el token y expone `request.portal = { cid, tid }`
- [x] 1.3 `POST /portal/request-access` (dni + fecha nac.): match por `dniHash` + `birthDate`; envía enlace al email de ficha; respuesta genérica; rate-limit 5/10 min
- [x] 1.4 Sesión: el enlace lleva el propio token de portal (60 min) que la web guarda en `sessionStorage` y usa como `Authorization` (sin canje separado, se simplifica)
- [x] 1.5 `setTenantContext({ tenantId, role: "CUSTOMER" })` en el preHandler (activa la capa Prisma por tenant)

## 2. Datos del paciente (backend, scoping por customerId)

- [x] 2.1 `GET /portal/me` (nombre, centro)
- [x] 2.2 `GET /portal/revisions`: revisiones completadas del cliente (producto, fecha, outcome, caducidad) — `where` con `customerId`
- [x] 2.3 `GET /portal/revisions/:id/pdf`: verifica dueño (`revision.customerId === cid`) → `ensureRevisionPdf`
- [x] 2.4 `GET /portal/appointments`: próximas + historial del cliente — `where` con `customerId`
- [x] 2.5 Auditoría en `audit_logs` de solicitud de acceso y de descarga (actor = cliente, userId NULL)

## 3. Frontend `app/mi-area`

- [x] 3.1 Segmento `app/mi-area/**` con layout ligero propio, mobile-first, sin chrome de staff
- [x] 3.2 Pantalla "Solicitar acceso" (`/mi-area/[slug]`, DNI + fecha de nacimiento) + estado "revisa tu email"
- [x] 3.3 Landing del enlace (`/mi-area/entrar?token=`) → guarda sesión → panel
- [x] 3.4 Panel (`/mi-area/panel`): "Mis reconocimientos" (lista + descargar PDF) y "Mis citas" (historial)
- [x] 3.5 Estados vacío/carga/sesión caducada (volver a solicitar acceso)

## 4. Seguridad

- [x] 4.1 Todas las consultas del portal filtran por `customerId` (regla de oro) — revisado
- [x] 4.2 Rate-limit específico en `request-access` + respuesta uniforme (anti-enumeración)
- [x] 4.3 Sesiones cortas (60 min); el `customerId` viaja en el token firmado, no en la URL
- [~] 4.4 Tests de aislamiento y descarga verificada — verificado con sonda contra datos reales; falta test automático de integración con BD (convención del repo son tests de núcleo puro)

## 5. Almacenamiento (producción)

- [ ] 5.1 Adaptador **R2** para `Storage` + `getSignedUrl` real (hoy `LocalStorage` sirve del disco del servidor)

## 6. Verificación

- [x] 6.1 `tsc --noEmit` (api + web) limpio
- [x] 6.2 Suite existente en verde (162); el flujo de datos del portal verificado con sonda (token + revisiones + citas del cliente demo)
- [x] 6.3 Prueba manual: página pública de acceso renderiza; `/portal/*` rechaza sin token (401)

## Limitaciones conocidas (MVP) → mejoras

- [ ] Enlace de acceso **solo por email** en el MVP (si la ficha no tiene email, el paciente no puede entrar). Añadir **SMS/WhatsApp** (necesita plantilla) como canal alternativo.
- [ ] `request-access` resuelve el tenant por `slug` en la URL (`/mi-area/[slug]`); no hay landing sin slug para "sesión caducada" (se muestra un mensaje genérico).

## 7. Fase 2 (posterior, fuera del MVP)

- [ ] 7.1 Reservar **renovación** desde el portal cuando el certificado esté por caducar (reutiliza booking por magic-link)
- [ ] 7.2 Reprogramar/cancelar la propia cita
- [ ] 7.3 Preferencias de aviso del paciente; (más adelante) pago online
