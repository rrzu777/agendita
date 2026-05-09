# Design Document: Agendita — SaaS Agenda para Manicuristas

**Date:** 2026-05-09  
**Status:** Ready for implementation plan  
**Author:** Prompt + AI design refinement  

---

## 1. Product Overview

Agendita es una webapp SaaS multi-tenant para manicuristas, inspirada en herramientas de reserva como Fresha pero enfocada exclusivamente en servicios de uñas para el mercado chileno/latinoamericano.

### 1.1 Frase del producto
> Tu agenda online para uñas: muestra tus servicios, recibe reservas con abono y controla tus pagos desde un solo lugar.

### 1.2 Flujo principal
```
Instagram / WhatsApp
→ Perfil público de la manicurista
→ Selección de servicio
→ Selección de día y hora disponible
→ Datos de la clienta
→ Pago de abono
→ Reserva confirmada
→ Control financiero en dashboard
```

### 1.3 Enfoque MVP
Construir un MVP sólido para una manicurista, pero con arquitectura preparada para varias. Ganar por simplicidad, no por cantidad de funcionalidades.

**Prioridad:**
1. Reservas simples y confiables
2. Perfil público elegante
3. Abonos bien registrados
4. Dashboard claro
5. Base financiera auditable
6. Multi-tenant con subdominios desde el inicio

**No incluir todavía:**
- Marketplace público de manicuristas
- App móvil nativa
- Inventario de productos
- Campañas de marketing
- Cupones avanzados
- Suscripciones pagadas
- Facturación tributaria completa
- Boletas automáticas
- Conciliación bancaria avanzada

---

## 2. Architecture

### 2.1 Multi-tenant with Subdomains

Each business gets its own subdomain:

```
mimosnails.agendita.com       → perfil público
mimosnails.agendita.com/book  → flujo de reserva
mimosnails.agendita.com/dashboard → panel privado
```

The main domain shows the platform landing:
```
agendita.com → landing pública
```

**Tenant resolution:**
- From `hostname` in public pages (parse subdomain)
- From authenticated `session` in private pages
- Never trust `businessId` from frontend

**Security rules:**
- All private queries filtered by `businessId`
- Cross-tenant access is blocked server-side
- `businessId` resolved via middleware/helpers server-side only

### 2.2 Tech Stack (Confirmed)

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Forms | React Hook Form |
| Validation | Zod |
| Backend | Server Actions + API Routes |
| Database | PostgreSQL (Supabase) |
| ORM | Prisma |
| Auth | Supabase Auth |
| Images | Cloudflare R2 |
| Email | Resend |
| Payments | Mercado Pago (MVP) + Mock (dev) |
| Testing | Vitest (unit) + Playwright (e2e) |
| Deployment | Vercel |

### 2.3 Project Structure

```
src/
  app/
    (marketing)/
      page.tsx                    # Landing pública

    (tenant)/
      page.tsx                    # Perfil público del negocio
      book/
        page.tsx                  # Flujo de reserva
      dashboard/
        layout.tsx                # Layout privado
        page.tsx                  # Resumen
        bookings/
          page.tsx                # Listado de reservas
        services/
          page.tsx                # CRUD servicios
        customers/
          page.tsx                # Clientas
        payments/
          page.tsx                # Finanzas
        reviews/
          page.tsx                # Moderación reseñas
        settings/
          page.tsx                # Configuración

    api/
      webhooks/
        mercado-pago/
          route.ts               # Webhook pagos

  components/
    public/                        # Perfil público
    booking/                       # Flujo de reserva
    dashboard/                     # Panel privado
    shared/                        # Reutilizables

  lib/
    auth/                          # Supabase auth helpers
    db/                            # Prisma client
    tenant/                        # Resolución de tenant
    payments/                      # Payment providers
    availability/                  # Slots, solapamientos
    finance/                       # Ledger, snapshots
    validations/                   # Zod schemas

  server/
    actions/                       # Server Actions
    queries/                       # Queries reutilizables
    services/                      # Lógica de negocio

  prisma/
    schema.prisma
    seed.ts
```

---

## 3. Data Model

### 3.1 Entities

```
User
Business
BusinessUser
Service
AvailabilityRule
TimeBlock
Customer
Booking
Payment
LedgerEntry
Review
GalleryImage
```

### 3.2 Prisma Schema (Core Models)

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  businesses BusinessUser[]
}

model Business {
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  subdomain       String   @unique
  customDomain    String?  @unique
  ownerUserId     String
  logoUrl         String?
  profileImageUrl String?
  bio             String?
  whatsapp        String?
  instagram       String?
  addressText     String?
  city            String?
  country         String   @default("CL")
  currency        String   @default("CLP")
  timezone        String   @default("America/Santiago")
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  users           BusinessUser[]
  services        Service[]
  availability    AvailabilityRule[]
  timeBlocks      TimeBlock[]
  customers       Customer[]
  bookings        Booking[]
  payments        Payment[]
  ledgerEntries   LedgerEntry[]
  reviews         Review[]
  galleryImages   GalleryImage[]
}

model BusinessUser {
  id         String       @id @default(cuid())
  businessId String
  userId     String
  role       BusinessRole
  createdAt  DateTime     @default(now())

  business   Business     @relation(fields: [businessId], references: [id])
  user       User         @relation(fields: [userId], references: [id])

  @@unique([businessId, userId])
}

enum BusinessRole {
  owner
  admin
  staff
}

model Service {
  id              String   @id @default(cuid())
  businessId      String
  name            String
  description     String?
  durationMinutes Int
  price           Int
  depositAmount   Int
  pastelColor     String
  isActive        Boolean  @default(true)
  sortOrder       Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  business        Business @relation(fields: [businessId], references: [id])
  bookings        Booking[]
}

model AvailabilityRule {
  id         String   @id @default(cuid())
  businessId String
  dayOfWeek  Int
  startTime  String
  endTime    String
  isActive   Boolean  @default(true)

  business   Business @relation(fields: [businessId], references: [id])
}

model TimeBlock {
  id            String   @id @default(cuid())
  businessId    String
  startDateTime DateTime
  endDateTime   DateTime
  reason        String?
  createdAt     DateTime @default(now())

  business      Business @relation(fields: [businessId], references: [id])
}

model Customer {
  id         String   @id @default(cuid())
  businessId String
  name       String
  phone      String
  email      String?
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  business   Business @relation(fields: [businessId], references: [id])
  bookings   Booking[]
  payments   Payment[]
  reviews    Review[]
}

model Booking {
  id                String               @id @default(cuid())
  businessId        String
  serviceId         String
  customerId        String
  startDateTime     DateTime
  endDateTime       DateTime
  status            BookingStatus

  totalPrice        Int
  depositRequired   Int
  depositPaid       Int                  @default(0)
  remainingBalance  Int
  discountAmount    Int                  @default(0)
  finalAmount       Int
  paymentStatus     BookingPaymentStatus

  customerNotes     String?
  internalNotes     String?
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt

  business          Business             @relation(fields: [businessId], references: [id])
  service           Service              @relation(fields: [serviceId], references: [id])
  customer          Customer             @relation(fields: [customerId], references: [id])
  payments          Payment[]
  ledgerEntries     LedgerEntry[]
  review            Review?
}

enum BookingStatus {
  pending_payment
  confirmed
  completed
  cancelled
  no_show
}

enum BookingPaymentStatus {
  unpaid
  deposit_paid
  fully_paid
  refunded
  failed
}

model Payment {
  id                String          @id @default(cuid())
  businessId        String
  bookingId         String
  customerId        String
  provider          PaymentProvider
  providerPaymentId String?
  amount            Int
  currency          String          @default("CLP")
  status            PaymentStatus
  paymentType       PaymentType
  paymentMethod     String?
  paidAt            DateTime?
  rawPayload        Json?
  createdAt         DateTime        @default(now())

  business          Business        @relation(fields: [businessId], references: [id])
  booking           Booking         @relation(fields: [bookingId], references: [id])
  customer          Customer        @relation(fields: [customerId], references: [id])
  ledgerEntries     LedgerEntry[]
}

enum PaymentProvider {
  mock
  mercado_pago
  webpay
  manual
}

enum PaymentStatus {
  pending
  approved
  rejected
  cancelled
  refunded
  failed
}

enum PaymentType {
  deposit
  final_payment
  full_payment
  refund
  cancellation_fee
  manual_adjustment
}

model LedgerEntry {
  id              String          @id @default(cuid())
  businessId      String
  bookingId       String?
  paymentId       String?
  customerId      String?
  type            LedgerEntryType
  direction       LedgerDirection
  amount          Int
  currency        String          @default("CLP")
  description     String?
  occurredAt      DateTime
  createdAt       DateTime        @default(now())
  createdByUserId String?

  business        Business        @relation(fields: [businessId], references: [id])
  booking         Booking?        @relation(fields: [bookingId], references: [id])
  payment         Payment?        @relation(fields: [paymentId], references: [id])
}

enum LedgerEntryType {
  booking_created
  deposit_paid
  final_payment_paid
  full_payment_paid
  refund_issued
  discount_applied
  cancellation_fee_charged
  manual_income
  manual_expense
  adjustment
}

enum LedgerDirection {
  income
  expense
  neutral
}

model Review {
  id         String   @id @default(cuid())
  businessId String
  bookingId  String   @unique
  customerId String
  rating     Int
  comment    String?
  isApproved Boolean  @default(false)
  createdAt  DateTime @default(now())

  business   Business @relation(fields: [businessId], references: [id])
  booking    Booking  @relation(fields: [bookingId], references: [id])
  customer   Customer @relation(fields: [customerId], references: [id])
}

model GalleryImage {
  id         String   @id @default(cuid())
  businessId String
  imageUrl   String
  caption    String?
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())

  business   Business @relation(fields: [businessId], references: [id])
}
```

---

## 4. Authentication & Authorization

### 4.1 Auth Provider: Supabase Auth

Using Supabase Auth with email/password. Each `User` in Supabase Auth maps to a `User` row in our database.

**Registration flow:**
1. User signs up via Supabase Auth (email + password)
2. On first login, redirect to onboarding (create Business)
3. For MVP, onboarding is manual — admin creates the first Business and assigns owner

### 4.2 Authorization Rules

- Private routes under `/dashboard` require authenticated session
- `businessId` resolved from session or hostname
- All database queries include `where: { businessId }`
- Row Level Security (RLS) in Supabase as additional safety net

---

## 5. Core Modules

### 5.1 Landing Pública

Ruta: `agendita.com`

- Hero claro con value proposition
- Beneficios para manicuristas
- Cómo funciona (3 pasos)
- CTA para crear cuenta / iniciar sesión
- Diseño pastel, elegante, mobile-first

### 5.2 Perfil Público del Negocio

Ruta: `mimosnails.agendita.com`

- Header: foto/logo, nombre comercial, bio
- Botones: WhatsApp, Instagram
- Ubicación/comuna
- Servicios activos (cards con color pastel)
- Galería de trabajos
- Reseñas aprobadas
- CTA principal: "Agendar hora"

### 5.3 Flujo de Reserva

Ruta: `mimosnails.agendita.com/book`

**Paso 1: Elegir servicio**
- Cards de servicios activos
- Nombre, descripción, precio, duración, abono, color pastel

**Paso 2: Elegir fecha**
- Calendario mostrando días disponibles
- Días bloqueados, sin horario, o sin slots suficientes deshabilitados

**Paso 3: Elegir hora**
- Slots de tiempo calculados según duración del servicio
- Validación de solapamientos
- No mostrar horas pasadas

**Paso 4: Datos de clienta**
- Nombre (obligatorio, mín 2 chars)
- Teléfono (obligatorio)
- Email (opcional, válido si se entrega)
- Comentario (opcional)

**Paso 5: Pago de abono**
- MockPaymentProvider en desarrollo
- En producción: Mercado Pago
- Estado inicial: `pending_payment`
- Post-aprobación: `confirmed`

**Paso 6: Confirmación**
- Servicio, fecha, hora
- Precio total, abono pagado, saldo pendiente
- Datos de contacto del negocio
- Política de cancelación

### 5.4 Dashboard Privado

Ruta: `mimosnails.agendita.com/dashboard`

**Sidebar:**
- Resumen
- Calendario
- Reservas
- Servicios
- Clientas
- Pagos
- Reseñas
- Perfil público
- Configuración

**Resumen:**
- Reservas de hoy
- Próximas reservas
- Ingresos del día/mes
- Total abonado / pendiente
- Cancelaciones / no-shows
- Servicios más solicitados

**Calendario:**
- Vista día / semana / mes
- Ver reservas
- Cambiar estado
- Bloquear horario
- Crear reserva manual

**Reservas:**
- Listado con filtros (hoy, semana, mes, estado, saldo pendiente)
- Acciones: ver, confirmar, completar, cancelar, no-show, registrar pago, nota interna

**Servicios:**
- CRUD completo
- Activar/desactivar
- Soft delete (no eliminar si tiene reservas)
- Ordenar
- Color pastel

**Clientas:**
- Listado con historial
- Total gastado
- Saldo pendiente
- Notas internas

**Pagos:**
- Historial de pagos y movimientos
- Filtros por fecha y método
- Exportación CSV

**Reseñas:**
- Ver reseñas
- Aprobar / ocultar
- Filtrar por calificación

**Perfil público:**
- Editar datos del negocio
- Subir foto/logo
- WhatsApp, Instagram, ubicación
- Galería
- Políticas de reserva/cancelación

---

## 6. Availability & Scheduling Rules

### 6.1 Availability Rules

- Horarios por día de semana (ej: Lunes 09:00-18:00)
- Días cerrados posibles
- Múltiples franjas por día (futuro, no MVP)

### 6.2 Time Blocks

Bloqueos manuales:
- Día completo
- Rango horario
- Motivo descriptivo

### 6.3 Slot Generation

- Generar slots usando `AvailabilityRule` + `TimeBlock` + `Booking`
- Un slot válido permite `startDateTime + service.durationMinutes` sin solapamientos
- Estados que ocupan horario: `pending_payment`, `confirmed`, `completed`
- Estados que NO ocupan: `cancelled`, `no_show`
- `endDateTime` calculado: `startDateTime + durationMinutes`

### 6.4 Concurrency Control (Double-Booking Prevention)

Usar transacciones con re-validación:

```
prisma.$transaction(async (tx) => {
  // 1. Re-validar slot libre (FOR UPDATE)
  // 2. Crear booking
  // 3. Crear customer si no existe
})
```

El slot se re-valida en el momento de creación, no solo al mostrar opciones.

---

## 7. Financial Module

### 7.1 Philosophy

No es contabilidad tributaria. Es control financiero interno:
- Saber cuánto se abonó
- Saber cuánto falta pagar
- Saber ingresos por día/semana/mes
- Historial auditable
- Exportación CSV para contador

### 7.2 Booking Financial Snapshot

Cada reserva guarda:
```
totalPrice        (precio al momento de reservar)
depositRequired   
depositPaid       
remainingBalance  
discountAmount    
finalAmount       
paymentStatus     
```

**Regla crítica:** Si cambia el precio del servicio, las reservas antiguas conservan el precio original.

### 7.3 Payment Lifecycle

**Estados de pago:**
```
pending → approved / rejected / cancelled / failed
approved → refunded
```

**Tipos de pago:**
```
deposit          → abono para confirmar
final_payment    → pago del saldo restante
full_payment     → pago total de una vez
refund           → reembolso
cancellation_fee → cargo por cancelación
manual_adjustment→ ajuste manual
```

### 7.4 Ledger Entries

Todo movimiento financiero crea un `LedgerEntry`:

| Evento | Tipo | Dirección |
|--------|------|-----------|
| Reserva creada | `booking_created` | neutral |
| Abono pagado | `deposit_paid` | income |
| Pago final | `final_payment_paid` | income |
| Pago total | `full_payment_paid` | income |
| Reembolso | `refund_issued` | expense |
| Descuento | `discount_applied` | neutral |
| Cargo cancelación | `cancellation_fee_charged` | income |
| Ingreso manual | `manual_income` | income |
| Gasto manual | `manual_expense` | expense |
| Ajuste | `adjustment` | income/expense/neutral |

### 7.5 Financial Rules

1. No borrar pagos ni movimientos
2. Usar reversos, reembolsos o ajustes
3. Pagos aprobados crean ledger income
4. Pagos fallidos NO crean ingresos
5. Saldo pendiente = finalAmount - pagos aprobados
6. Redirect de pago NO confirma por sí solo
7. Confirmación por webhook o validación server-side

### 7.6 Dashboard Financiero

**Cards:**
- Ingresos hoy / mes
- Total abonado
- Total pendiente
- Reservas con saldo pendiente
- Cancelaciones / no-shows

**Reportes:**
- Ingresos por servicio
- Ingresos por método de pago
- Abonos por mes
- Saldos pendientes por clienta
- Historial de movimientos

**Exportación CSV:**
```
fecha, tipo_movimiento, cliente, servicio, reserva, monto, moneda, metodo_pago, estado, descripcion
```

---

## 8. Payment Integration

### 8.1 Payment Provider Interface

```typescript
interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>
  handleWebhook(payload: unknown): Promise<WebhookPaymentResult>
}
```

### 8.2 Providers

| Provider | Uso |
|----------|-----|
| `mock` | Desarrollo y testing |
| `manual` | Pagos fuera del sistema (efectivo, transferencia) |
| `mercado_pago` | Producción (MVP) |
| `webpay` | Futuro |

### 8.3 MockPaymentProvider

- Simula pago aprobado/rechazado
- Permite testing sin proveedor real
- Toggle en dashboard de admin (dev-only)

### 8.4 Critical Rule

> Nunca marcar un pago como aprobado solo porque el usuario volvió a la pantalla de éxito.

- Siempre validar server-side o por webhook
- Si webhook falla, dashboard permite confirmación manual
- Estado `pending_payment` como estado seguro intermedio

### 8.5 Error Handling & Compensation

Patrón de estados y compensación:
1. Crear booking en `pending_payment` (sin bloquear plata)
2. Intentar pago
3. Si falla → booking queda pendiente, reintentable
4. Si aprueba pero webhook falla → "confirmar manualmente" en dashboard

Nunca hacer pago + booking atómico (imposible con proveedores externos).

---

## 9. Notifications

### 9.1 Email (Resend)

**Emails transaccionales:**
- Confirmación de reserva (clienta + negocio)
- Recordatorio 24h antes
- Pago recibido
- Cancelación

**Notificaciones al negocio:**
- Nueva reserva recibida
- Pago recibido
- Cancelación por clienta

### 9.2 WhatsApp

Post-MVP. Evaluar Twilio o proveedor local chileno cuando haya tracción.

---

## 10. Cancellation Policies (Configurable)

Configurables desde dashboard del negocio:

```
- Ventana de cancelación (ej: 24h antes)
- Política de reembolso de abono:
  * Sí / No / Parcial
- Motivos de cancelación predefinidos
- Mensaje automático al cancelar
```

**Estados de cancelación:**
- Clienta cancela → booking `cancelled`
- No-show → booking `no_show`
- Cancelación libera el horario inmediatamente

---

## 11. Image Handling

### 11.1 Storage: Cloudflare R2

- Upload via presigned URLs o directo con S3-compatible API
- Optimización: variantes en Cloudflare Images (opcional)
- Carpetas por negocio: `businesses/{businessId}/gallery/`, `businesses/{businessId}/profile/`

### 11.2 Entities with Images

- `Business.logoUrl`
- `Business.profileImageUrl`
- `GalleryImage.imageUrl`

---

## 12. Testing Strategy

### 12.1 Unit Tests (Vitest)

- Lógica de disponibilidad (slot generation, solapamientos)
- Lógica financiera (cálculo de saldos, ledger entries)
- Validaciones Zod
- Tenant resolution

### 12.2 E2E Tests (Playwright)

- Flujo completo de reserva
- Creación de servicio desde dashboard
- Cambio de estado de reserva
- Exportación CSV

### 12.3 Test Data

Seed con:
- 2-3 negocios
- 5-10 servicios
- 10-20 reservas variadas
- Pagos y ledger entries
- Reseñas

---

## 13. Deployment & Infrastructure

### 13.1 Vercel

- Next.js App Router nativo
- Edge Functions para middleware de tenant
- Environment variables para:
  * `DATABASE_URL` (Supabase)
  * `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  * `RESEND_API_KEY`
  * `MERCADO_PAGO_ACCESS_TOKEN`
  * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`
  * `NEXT_PUBLIC_APP_DOMAIN`

### 13.2 Local Development

- Supabase local (CLI) o conexión a proyecto dev
- MockPaymentProvider activo por defecto
- Seed automático al iniciar

---

## 14. Roadmap

### Phase 1: Base técnica
- Proyecto Next.js + Tailwind + shadcn/ui
- Supabase + Prisma configurado
- Schema DB + seed
- Middleware de tenant por subdominio
- Auth básico

### Phase 2: Perfil público
- Resolver negocio por subdominio
- Mostrar perfil, servicios, galería, reseñas
- CTA de reserva

### Phase 3: Servicios y disponibilidad
- CRUD servicios
- Configuración horarios
- Bloqueo de horarios
- Generador de slots
- Validación solapamientos

### Phase 4: Reservas
- Flujo de reserva público
- Creación customer + booking
- Estado `pending_payment`
- Confirmación manual temporal

### Phase 5: Finanzas
- Payment + LedgerEntry
- Registro de abonos y pagos finales
- Dashboard financiero
- Exportación CSV

### Phase 6: Pagos online
- PaymentProvider interface
- Mock provider
- Mercado Pago
- Webhooks
- Confirmación server-side

### Phase 7: Beta
- Onboarding de primera manicurista
- Testing con usuarios reales
- Métricas: reservas, mensajes evitados, plantones reducidos

---

## 15. Decisions Summary

### Sí desde el inicio
- Subdominio por negocio
- Business como entidad principal
- `businessId` en todas las entidades
- Payment + LedgerEntry
- Snapshots financieros en Booking
- MockPaymentProvider
- Diseño mobile-first
- Servicios con colores pasteles
- Dashboard simple pero útil
- Exportación CSV

### No todavía
- Marketplace
- App móvil nativa
- Inventario
- Boletas automáticas / SII
- Suscripciones SaaS
- Cupones complejos
- Campañas de marketing
- Múltiples profesionales por negocio
- Dominio personalizado
- WhatsApp notifications

---

## 16. Open Questions / Future Work

1. **Dominio propio:** Permitir `www.mimosnails.cl` apuntando a la app. Requiere DNS management.
2. **Recordatorios automáticos:** Cron job para enviar emails 24h antes.
3. **Reagendamiento:** Permitir a la clienta cambiar fecha/hora sin cancelar.
4. **Múltiples manicuristas por negocio:** Roles `staff` con agenda individual.
5. **Suscripciones SaaS:** Cobrar a las manicuristas por usar la plataforma.
6. **Analytics:** Métricas de conversión, servicios más vistos, etc.

---

*End of design document*
