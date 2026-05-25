# Go/No-Go Beta Real — Agendita

## Checklist consolidada Prompts 01-10 + Mercado Pago multi-tenant

### 1. Producto base

| Item | Estado | Notas |
|------|--------|-------|
| Registro robusto | ✅ GO | Subdomain validation, transaccional, RegistrationError, checkSubdomainAvailability |
| Onboarding wizard | ✅ GO | 5 pasos, persiste progreso, valida servicios+horarios mínimo |
| Dashboard settings | ✅ GO | Nombre, dirección, redes, políticas |
| Servicios CRUD | ✅ GO | Crear, editar, activar/desactivar, reordenar |
| Horarios semanales | ✅ GO | Configuración por día |
| Link público | ✅ GO | Subdominio y slug |

### 2. Reservas

| Item | Estado | Notas |
|------|--------|-------|
| Reserva pública | ✅ GO | Booking wizard con steps: servicio → fecha/hora → datos → pago → confirmación |
| Reserva manual | ✅ GO | Dashboard `/dashboard/bookings/new`, crear con o sin abono |
| Calendario dashboard | ✅ GO | Vista mensual + DayPanel con bookings y TimeBlocks |
| No doble-booking | ✅ GO | Advisory lock + EXCLUDE constraint + assertSlotIsAvailable |
| TimeBlocks | ✅ GO | Crear, listar, eliminar; presets (Almuerzo, Tarde libre, Día completo) |
| Holds expiran | ✅ GO | Cron cada 5min, idempotente, CRON_SECRET protegido |
| Cancelación | ✅ GO | Dashboard: completar, cancelar (con email) |
| Reprogramación | ✅ GO | Dashboard: nueva fecha/hora con validación, excluye slot propio |

### 3. Pagos manuales

| Item | Estado | Notas |
|------|--------|-------|
| Payment correcto | ✅ GO | Provider=manual, amount, currency validados server-side. Abono inicial marca PaymentType=deposit (fix Prompt 1) |
| LedgerEntry correcto | ✅ GO | applyApprovedPayment central, una entrada por pago. Ledger abono = deposit_paid (fix Prompt 1) |
| No duplicados | ✅ GO | Unique constraint paymentId en LedgerEntry; idempotencia en applyApprovedPayment |
| Saldo correcto | ✅ GO | recalcBookingFromPayments recalcula depositPaid, remainingBalance, paymentStatus. Servicio sin abono con precio NO queda fully_paid (fix Prompt 1) |
| Creación dashboard sin abono | ✅ GO | depositRequired=0, price>0 → confirmed + unpaid + remainingBalance=finalAmount |
| Reserva pública manual (sin MP) | ✅ GO | Fallback: crea booking pending_payment sin initiatePayment; ConfirmationMode=pending: "Reserva recibida", "Total por pagar" = precio completo |
| Switch PAYMENT_PROVIDER=manual | ✅ GO | Fuerza checkout offline incluso con PaymentAccount.connected; mock/webpay también bloquean MP |

### 4. Suscripción

| Item | Estado | Notas |
|------|--------|-------|
| Plan Beta gratis | ✅ GO | Creado por backfill de migración |
| Business.planId | ✅ GO | Asignado automáticamente en registro y backfill |
| SubscriptionStatus | ✅ GO | trialing/active/past_due/suspended/cancelled |
| Trial | ✅ GO | 30 días en signUp, 90 días en seed |
| Admin marca pago | ✅ GO | Panel admin registra pago manual, actualiza estado |
| Suspensión bloquea bookings | ✅ GO | assertBusinessCanReceiveBookings en createBooking público |
| Dashboard billing | ✅ GO | `/dashboard/billing`: plan, trial, historial, instrucciones |

### 5. Admin / Soporte

| Item | Estado | Notas |
|------|--------|-------|
| Panel protegido | ✅ GO | PLATFORM_ADMIN_EMAILS, server-side check |
| Lista negocios | ✅ GO | Nombre, subdominio, plan, estado, #reservas |
| Detalle negocio | ✅ GO | Reservas, pagos, bitácora |
| Acciones | ✅ GO | Suspender, reactivar, extender trial, registrar pago |
| Audit log | ✅ GO | SubscriptionLog con adminUserId, adminEmail, before/after |
| Sin impersonation | ✅ GO | No implementado |

### 6. Legal

| Item | Estado | Notas |
|------|--------|-------|
| Términos | ✅ GO | `/terms` |
| Privacidad | ✅ GO | `/privacy` |
| Reembolsos | ✅ GO | `/refund-policy` |
| Aceptación registro | ✅ GO | Server-side: signUp requiere acceptedTerms='true' |
| Aceptación booking | ✅ GO | Server-side: createBooking requiere acceptedTerms=true |
| Textos marcados revisión | ✅ GO | Borrador para abogado |

### 7. Seguridad

| Item | Estado | Notas |
|------|--------|-------|
| Tenant isolation | ✅ GO | Todos los queries scoped por businessId; assertResourceBelongsToBusiness |
| No businessId cliente | ✅ GO | businessId siempre desde sesión; frontend no decide tenant |
| Server actions protegidas | ✅ GO | requireBusiness/requireBusinessRole en todas las mutations |
| Secrets no expuestos | ✅ GO | .env.local fuera de git; tokens cifrados en DB |
| Admin protegido | ✅ GO | PLATFORM_ADMIN_EMAILS + isPlatformAdmin server-side |

### 8. Operaciones

| Item | Estado | Notas |
|------|--------|-------|
| Vercel deploy | ✅ GO | Build exitoso con `npm run build` |
| Cron expire-holds | ✅ GO | `/api/cron/expire-holds` con CRON_SECRET |
| Cron reminders | ✅ GO | `/api/cron/send-reminders` con CRON_SECRET + dedupe |
| Migraciones | ✅ GO | 6 migraciones incrementales, db up to date |
| Rollback | ⚠️ PLAN | Desactivar MP por negocio, pasar a manual, revertir deploy |
| Monitoreo | ⚠️ PLAN | Logs en Vercel, revisión diaria |

### 9. Mercado Pago multi-tenant

| Item | Estado | Notas |
|------|--------|-------|
| PaymentAccount model | ✅ GO | Por negocio, tokens cifrados AES-256-GCM |
| Provider por negocio | ✅ GO | getOnlinePaymentProviderForBusiness |
| initatePayment per-business | ✅ GO | Guard global reemplazado por resolveOnlinePaymentAvailabilityForBusiness. Solo mercado_pago + connected |
| getOnlinePaymentAvailability per-business | ✅ GO | Acepta businessId opcional, resuelve por negocio si se provee (fix Prompt 2) |
| PAYMENT_PROVIDER opcional | ✅ GO | No requerido si hay OAuth configurado (CLIENT_ID, CLIENT_SECRET, REDIRECT_URI) (fix Prompt 2) |
| Webhook multi-tenant | ✅ GO | Busca PaymentAccount desde Payment.localPaymentId, re-verifica con token del negocio |
| OAuth connect flow | ✅ GO | `/dashboard/settings/payments`, callback con state anti-CSRF |
| Disconnect | ✅ GO | paymentAccount.status = 'disconnected' |
| No split payments | ✅ GO | No implementado |
| No comisiones | ✅ GO | No implementado |
| No confirmar por redirect | ✅ GO | Solo webhook confirma |

### Decisión GO / NO-GO (actualizado 2026-05-25 post-Prompts 1-4)

**GO para beta manual:**
- Reservas públicas y manuales funcionan
- Reserva pública sin MP crea pending_payment (fallback manual, fix Review 3.5)
- Doble-booking bloqueado
- Holds expiran
- Ledger manual no duplica (abono = deposit_paid, final = final_payment_paid)
- Servicio sin abono no queda fully_paid (fix Prompt 1)
- Admin soporte existe (4 acciones: pago, extender trial, suspender, reactivar)
- Legal publicado (términos, privacidad, reembolsos)
- Onboarding checklist en dashboard
- WhatsApp manual (confirmación + copiar resumen)
- Tests: 722 tests pasan
- Env: PAYMENT_PROVIDER=manual válido; production con OAuth válido sin access token global
- Lint: 3 errores preexistentes (no-explicit-any en tests), 0 errores nuevos

**GO para Mercado Pago sandbox:**
- Infraestructura multi-tenant lista (PaymentAccount, OAuth, webhook fail-closed)
- initiatePayment usa per-business availability (fix Prompt 2)
- Requires: MERCADO_PAGO_CLIENT_ID, MERCADO_PAGO_CLIENT_SECRET, MERCADO_PAGO_REDIRECT_URI
- Requires: 2 cuentas sandbox de prueba
- Requires: ejecutar plan QA

**NO-GO para Mercado Pago producción:**
- Hasta completar QA sandbox completo

### Plan beta recomendado

1. **Fase 1:** Mimos Nails, pago manual, 1 semana
2. **Fase 2:** 2-3 profesionales amigas, pago manual, soporte directo
3. **Fase 3:** Mercado Pago sandbox, sin dinero real
4. **Fase 4:** Mercado Pago real para 1 negocio, monitoreo diario

### Métricas diarias

- Reservas creadas / completadas
- Cancelaciones / no-shows
- Abonos registrados
- Errores Vercel
- Logs cron (holds + reminders)
- Pagos/ledger sospechosos

### Rollback plan

1. Desactivar Mercado Pago por negocio (disconnect)
2. Pasar a pago manual
3. Suspender negocio si es necesario
4. Revertir deploy (Vercel)
5. Corrección DB solo con backup
