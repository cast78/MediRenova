## Why

Los centros médicos que realizan reconocimientos para renovar documentos oficiales (carnet de conducir, licencia de armas, DNI) gestionan sus reservas, revisiones y seguimiento de caducidades de forma manual o con herramientas genéricas. Esto genera pérdida de clientes por falta de recordatorios proactivos y cuellos de botella operativos. MediRenova es un CRM SaaS multitenant diseñado específicamente para este nicho, que automatiza el ciclo completo desde la detección de caducidad hasta la emisión del certificado médico.

## What Changes

- Plataforma SaaS nueva, construida desde cero
- **Sistema multitenant** con aislamiento lógico por tenant (row-level security en PostgreSQL)
- **Gestión de centros y salas** con horarios semanales, festivos y disponibilidad dinámica de slots
- **Catálogo de productos** con reglas de renovación por edad (normativa DGT, licencias de armas, DNI)
- **Builder visual de formularios** con schema JSON versionado por producto
- **Flujo de reserva completo**: backoffice, magic link (sin login) y API pública
- **Revisión médica digital** con formulario dinámico, adjunto de fotos y generación de PDF síncrona
- **Workflow comercial automático**: alertas de caducidad por WhatsApp 90/60/30 días antes con reintentos
- **Dashboard de gestión** con KPIs, caducidades próximas y gráficos de actividad
- **API pública REST** autenticada por API Key para integraciones de terceros
- Stack: Next.js 14 + Fastify + Prisma + PostgreSQL (Neon) + Cloudflare R2 + Puppeteer + Meta Cloud API

## Capabilities

### New Capabilities

- `multitenancy`: Aislamiento lógico por tenant con branding, configuración y API Keys propios
- `auth`: Autenticación JWT (access + refresh), roles (superadmin, admin, médico, recepcionista)
- `centers`: Gestión de centros médicos con geolocalización, salas, horarios y festivos
- `products`: Catálogo de productos con reglas de renovación por edad y plantillas PDF
- `form-builder`: Builder visual de formularios dinámicos con schema JSON versionado
- `customers`: Gestión de clientes con datos personales, DNI, historial de revisiones y GDPR
- `appointments`: Reservas con disponibilidad dinámica, estados y protección contra double-booking
- `magic-link`: Flujo de reserva sin login mediante token JWT de 24h enviado por WhatsApp
- `revisions`: Revisión médica con formulario dinámico, adjunto de fotos y generación de PDF
- `commercial-workflow`: Motor de alertas automáticas de caducidad vía WhatsApp con reintentos
- `dashboard`: Panel de KPIs con caducidades próximas, reservas y métricas de conversión
- `public-api`: API REST pública autenticada por API Key para disponibilidad, clientes y reservas

### Modified Capabilities

## Impact

- Sistema greenfield: no hay código existente afectado
- Dependencias externas: Meta Cloud API (WhatsApp), Cloudflare R2 (storage), Neon (PostgreSQL serverless), Puppeteer (PDF), Vercel (frontend deploy), Railway (backend deploy)
- Cumplimiento GDPR obligatorio: DNI encriptado en reposo, consentimiento registrado con timestamp + IP, derecho al olvido mediante soft delete
- Normativa DGT: las reglas de renovación de carnet de conducir deben reflejar la legislación vigente española (Reglamento General de Conductores)
