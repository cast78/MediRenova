## 1. Acceso y sesión de portal (backend)

- [ ] 1.1 Token de portal: `signPortalToken({ cid, tid })` / `verifyPortalToken` (`type: "portal"`, caducidad corta) en `lib/jwt.ts`
- [ ] 1.2 Exención del grupo `/portal/*` en `plugins/auth.ts` (como `/link/*`); `preHandler` de portal que valida el token y expone `{ cid, tid }`
- [ ] 1.3 `POST /portal/request-access` (dni + fecha nac.): match por `dniHash` + `birthDate`; envía enlace al contacto de ficha (email/SMS); respuesta genérica; rate-limit por IP y por DNI
- [ ] 1.4 `POST /portal/session`: canjea el token del enlace por una sesión de portal
- [ ] 1.5 `setTenantContext({ tenantId, role: "CUSTOMER" })` en el preHandler para activar la capa Prisma por tenant

## 2. Datos del paciente (backend, scoping por customerId)

- [ ] 2.1 `GET /portal/me` (nombre, centro)
- [ ] 2.2 `GET /portal/revisions`: revisiones completadas del cliente (producto, fecha, outcome, caducidad, tienePdf) — `where` con `customerId`
- [ ] 2.3 `GET /portal/revisions/:id/pdf`: verifica dueño (`revision.customerId === cid`) → `ensureRevisionPdf`
- [ ] 2.4 `GET /portal/appointments`: próximas + historial del cliente — `where` con `customerId`
- [ ] 2.5 Auditoría en `audit_logs` de accesos y descargas (actor = cliente)

## 3. Frontend `app/mi-area`

- [ ] 3.1 Segmento `app/mi-area/**` con layout ligero propio (branding del centro), mobile-first, sin chrome de staff
- [ ] 3.2 Pantalla "Solicitar acceso" (DNI + fecha de nacimiento) + estado "revisa tu email/SMS"
- [ ] 3.3 Landing del enlace → canjea sesión → guarda token (sessionStorage) → panel del paciente
- [ ] 3.4 "Mis reconocimientos" (lista + descargar PDF) y "Mis citas" (próximas/historial)
- [ ] 3.5 Estados vacíos, error y sesión caducada (volver a solicitar acceso)

## 4. Seguridad

- [ ] 4.1 Revisión de que **todas** las consultas del portal filtran por `customerId` (regla de oro)
- [ ] 4.2 Rate-limit específico anti-enumeración en `request-access`; respuesta uniforme
- [ ] 4.3 Sesiones cortas; no exponer `customerId` en URLs (viaja en el token)
- [ ] 4.4 Tests: aislamiento (una sesión no accede a datos de otro cliente) + descarga verificada

## 5. Almacenamiento (producción)

- [ ] 5.1 Adaptador **R2** para `Storage` + `getSignedUrl` real (hoy stub local); servir el PDF por URL firmada de corta vida

## 6. Verificación

- [ ] 6.1 `tsc --noEmit` (api + web) limpio
- [ ] 6.2 Tests del acceso, del scoping por cliente y de la descarga verificada
- [ ] 6.3 Prueba manual del journey completo (solicitar → enlace → descargar) en un tenant demo

## 7. Fase 2 (posterior, fuera del MVP)

- [ ] 7.1 Reservar **renovación** desde el portal cuando el certificado esté por caducar (reutiliza booking por magic-link)
- [ ] 7.2 Reprogramar/cancelar la propia cita
- [ ] 7.3 Preferencias de aviso del paciente; (más adelante) pago online
