# Mensajería al paciente — guía de operación

Cómo funciona la comunicación con el paciente en MediRenova (WhatsApp, email y SMS), qué se ve hoy en **modo demo** y, paso a paso, cómo activar cada canal real cuando tengas dominio y proveedores. Especificación completa en `openspec/changes/crm-mensajeria/`.

---

## 1. Estado actual: modo demo

Sin dominio ni proveedores, el CRM **ya decide y redacta** todos los avisos; lo único que no hace es enviarlos. Cada aviso queda registrado tal y como lo recibiría el paciente, con el canal elegido y un **enlace real** que funciona.

### Dónde se ve

| Pantalla | Ruta | Quién | Para qué |
|---|---|---|---|
| Ficha del paciente → pestaña **Comunicaciones** | `/customers/{id}?tab=comunicaciones` | Recepción y admin | Qué ha recibido este paciente, vista previa por canal, "Abrir como el paciente", copiar texto |
| Configuración → **Comunicaciones** (bandeja global) | `/settings?tab=comunicaciones` | Admin | KPIs del periodo, filtros, tabla de todos los avisos, estado de canales |

### Qué dispara un aviso (y por qué canal)

| Evento | Cuándo | Orden de canales |
|---|---|---|
| Cita creada | Alta en recepción, reserva pública, enlace mágico | WhatsApp → SMS → Email |
| Cita reprogramada | Reprogramar desde Reservas | WhatsApp → SMS → Email |
| Pedir confirmación | Botón "Pedir confirmación" | WhatsApp → Email → SMS |
| No-show · invitación | Registrar contacto por WhatsApp/Email en Recuperar | El canal usado |
| Renovación | Workflow automático (08:00) | WhatsApp → SMS → Email |
| Acceso al portal | El paciente pide acceso en Mi área | Email → SMS → WhatsApp |

Regla de selección: el primer canal del orden que **tenga medio de contacto en la ficha** y **consentimiento RGPD**. Si ninguno cumple, el aviso queda **Omitido** con el motivo (p. ej. "WhatsApp: sin consentimiento · SMS: sin teléfono"). Excepción: el **acceso al portal** es un mensaje de servicio pedido por el propio paciente y no exige consentimiento de marketing (sí medio de contacto).

### Estados y su significado

| Chip | Significado |
|---|---|
| **Simulado** (ámbar) | Redactado y guardado; no enviado porque el canal no tiene proveedor. Desaparece al activar el canal. |
| **Enviado** | El proveedor aceptó el mensaje. |
| **Entregado** / **Leído** | Confirmado por el proveedor (requiere webhooks, Fase A/B). Solo WhatsApp informa lectura. |
| **Omitido** (gris punteado) | No se pudo enviar por ningún canal: sin consentimiento o sin medio. Es una tarea para recepción. |
| **Fallido** (rojo) | El proveedor rechazó el envío (número sin WhatsApp, email que rebota). |

Nunca se muestra "Entregado" o "Leído" sin proveedor real.

### KPIs de la bandeja global

- **Generados** (+ desglose por canal): carga de trabajo que el sistema absorbe; por dónde se comunica la clínica.
- **Entregados** (%): tasa de alcance; si baja, hay datos de contacto malos o un problema de proveedor.
- **Leídos**: atención real (solo WhatsApp); cruzado con no-shows mide si el aviso funciona.
- **Omitidos**: pacientes "incomunicables" (RGPD o ficha incompleta) que recepción debe resolver.
- **Fallidos**: calidad de datos y salud del canal; si hubo reintento por otro canal, el aviso no se perdió.

En modo demo, Entregados y Leídos están a 0 (nadie confirma entregas); el resto cuenta desde ya.

### Enlaces que viajan en los mensajes

Todos son **enlaces cortos** `https://{PUBLIC_URL}/b/CODE` que redirigen según su tipo: confirmar cita (`/confirmar/...`), auto-reserva (`/booking/...`) o acceso al portal (`/mi-area/entrar`). Los de cita y reserva valen **30 días**; el del portal, **60 minutos** (sesión).

---

## 2. Activar el email (Resend) — cuando tengas dominio

Requisito: un **dominio propio** (Resend no permite enviar desde Gmail/Outlook). Tiempo total ≈ 30 min + verificación DNS.

1. **Cuenta**: https://resend.com/signup → plan Free (3.000/mes, 100/día, 1 dominio).
2. **Dominio**: Domains → *Add Domain* → tu dominio raíz (sin `www`) → **Region: Europe (Ireland)** (RGPD).
3. **DNS** (en el panel de tu registrador o Cloudflare; copia los valores exactos que muestra Resend):
   - `TXT  resend._domainkey` → DKIM (firma).
   - `MX   send` (prioridad 10) → return-path (rebotes).
   - `TXT  send` → `v=spf1 include:amazonses.com ~all`.
   - Opcional recomendado: `TXT _dmarc` → `v=DMARC1; p=none;`.
   - En Cloudflare, TXT/MX van sin proxy ("DNS only"). Si ya tienes un SPF en `@` por otro servicio, no lo toques: Resend usa el subdominio `send`.
   - *Verify DNS Records* → suele pasar a **Verified** en 5–30 min (hasta 48 h en algunos proveedores).
4. **API key**: API Keys → *Create* → permiso **Sending access**, restringida al dominio. Se muestra una sola vez (`re_…`); guárdala en un gestor de contraseñas, nunca en el repositorio ni en el chat.
5. **Railway** → servicio de la API → *Variables*:
   - `RESEND_API_KEY` = `re_…`
   - `EMAIL_FROM` = `MediRenova <avisos@tudominio.es>` (el buzón no tiene por qué existir; `avisos@` o `citas@` mejor que `no-reply@`).
   - Comprueba `PUBLIC_URL` = URL real del front (de ahí salen los enlaces).
   - Al guardar, Railway redespliega solo (1–3 min). El cliente de email se crea al arrancar: **cambiar variables siempre requiere reinicio**.
6. **Probar**: Configuración → Comunicaciones → tarjeta Email debe decir **Conectado** → *Probar conexión* → llega un email al admin. En Resend → *Emails* aparece *Delivered*.

Qué cambia en la app al activarlo:
- El portal **deja de mostrar el enlace en pantalla** y lo envía al email de la ficha.
- Los avisos cuyo canal elegido sea Email salen de verdad (chip "Enviado"); el resto sigue "Simulado".
- Los KPIs de Entregados empiezan a contar cuando se conecte el webhook de Resend (tarea A.2.8).

**No pongas la clave en tu `.env` local**: el entorno local apunta a la base de datos de producción y enviaría emails a pacientes reales.

---

## 3. Activar WhatsApp (Meta Cloud API)

Empieza el trámite cuanto antes: la **aprobación de plantillas tarda 48–72 h**.

1. **Meta Business Suite** → cuenta de empresa verificada → **WhatsApp Business Account** → número de teléfono (no puede estar en un WhatsApp personal) → *System User* con **token permanente**. Anota *Phone Number ID* y *WABA ID*.
2. **Plantillas** (categoría *Utility* salvo campañas → *Marketing*; idioma `es`; botón URL dinámico `https://{tu-dominio}/b/{{1}}`). Textos propuestos en `openspec/changes/crm-mensajeria/tasks.md` (B.1.2): `medirenova_confirmacion_cita`, `medirenova_recordatorio_cita`, `medirenova_recuperacion_noshow`, `medirenova_renovacion`, `medirenova_acceso_portal`, `medirenova_test`.
3. **Variables** (Railway): `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_TEMPLATE_RENEWAL`.
   - **Importante (estado actual)**: el envío real lee estas variables del **servidor** (globales). Lo que se guarda en Configuración → WhatsApp por clínica **todavía no se usa para enviar** y el token se guarda sin cifrar; la Fase B lo corrige (credenciales por clínica cifradas). Hasta entonces, configura las variables en Railway.
4. **Webhook** (Fase B): `{API_URL}/webhooks/meta` con `META_WA_VERIFY_TOKEN`; necesario para estados de entrega/lectura y para procesar "STOP".
5. **Probar**: Configuración → Comunicaciones → WhatsApp → *Probar conexión* (hoy solo valida que hay credenciales; en Fase B envía la plantilla de prueba al móvil del admin).

Límites a tener en cuenta: un número nuevo empieza con 250 conversaciones/24 h y sube con el uso; Meta solo permite **plantillas aprobadas** para mensajes iniciados por la empresa (nada de texto libre).

---

## 4. Activar SMS

No hay proveedor integrado (Fase C). Recomendación: **LabsMobile** o **Esendex** (API HTTP sencilla, remitente alfanumérico "MediRenova" de hasta 11 caracteres, precios para España); Twilio si se prefiere el más documentado. Pasos cuando toque: cuenta → API key → variables por clínica en Configuración → SMS → *Probar conexión*. Hasta entonces, SMS cuenta como canal **simulado** y aparece así en la bandeja.

---

## 5. Alternativas sin dominio (solo demo)

- **Email por Gmail SMTP**: cuenta Gmail nueva + contraseña de aplicación; requiere un adaptador `SmtpEmailClient` (no implementado). 500 emails/día, remitente `@gmail.com`.
- **WhatsApp con número de prueba de Meta**: gratis, hasta 5 móviles registrados, sin verificación de empresa; útil para que el público de una demo reciba el mensaje de verdad.

Ninguna sustituye a la configuración real de los apartados 2–4.

---

## 6. Variables de entorno (API)

| Variable | Para qué | Estado |
|---|---|---|
| `PUBLIC_URL` | Base de todos los enlaces de los mensajes (front) | Obligatoria |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email real (Resend) | Fase A |
| `META_WA_PHONE_NUMBER_ID`, `META_WA_ACCESS_TOKEN`, `META_WA_TEMPLATE_RENEWAL` | WhatsApp real (Meta), globales hasta Fase B | Fase B |
| `CONFIG_ENCRYPTION_KEY` | Cifrado de tokens de proveedor guardados por clínica (64 hex) | Fase B (pendiente) |
| `META_WA_VERIFY_TOKEN`, `RESEND_WEBHOOK_SECRET` | Verificación de webhooks | Fases A/B (pendiente) |

Con ninguna de las de proveedor configurada, todos los canales están en **modo demo**.

---

## 7. Checklist antes de comunicar con pacientes reales

- [ ] Rotar la contraseña de Neon expuesta (Neon + Railway + `.env` local).
- [ ] Dominio verificado en Resend y *Probar conexión* OK.
- [ ] `PUBLIC_URL` apunta al dominio real.
- [ ] Consentimientos RGPD firmados en las fichas (sin consentimiento → Omitido).
- [ ] Pie de **baja** en campañas (Fase A.2.7; obligatorio por LSSI en comunicaciones comerciales).
- [ ] Webhooks de Resend/Meta conectados para rebotes, entregas y "STOP".
- [ ] Plantillas de WhatsApp aprobadas y nombres coincidentes con los del CRM.

---

## 8. Resolución de problemas

- **"No le llega nada"**: mira primero el chip en su ficha → Comunicaciones. *Simulado* = canal sin proveedor; *Omitido* = falta consentimiento o medio (arréglalo en Datos/RGPD); *Fallido* = el proveedor lo rechazó (lee el motivo).
- **Enlace caducado**: los de cita/reserva valen 30 días; el del portal, 60 min. Genera otro desde la pantalla correspondiente.
- **He cambiado una variable y no hace efecto**: los clientes se crean al arrancar; reinicia el servicio (Railway lo hace al guardar variables).
- **La tarjeta WhatsApp dice "Conectado" pero los avisos siguen "Simulado"**: las credenciales por clínica aún no se usan para enviar (ver apartado 3); configura las variables en Railway o espera a la Fase B.
