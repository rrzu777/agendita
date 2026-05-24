# QA Functional Plan

## Scope

End-to-end functional tests covering the booking + payment flow, notification system, and error handling.

## Environment

- **Provider**: `mock` (PAYMENT_PROVIDER=mock)
- **Bookings**: Use real service + customer created during test
- **Payments**: Mock payment flow (no real Mercado Pago calls)
- **Notifications**: Console/log-based (check notification calls)
- **Database**: Test database with foreign key constraints enforced

---

## Test Categories

### 1. Happy Path — Complete Booking Flow

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-01 | Full booking: create → pay deposit → confirm → complete | 1. Create booking via public form<br>2. Simulate Mercado Pago webhook with `payment_status=approved`<br>3. Call `confirmPayment`<br>4. Call `updateBookingStatus` to `completed` | Booking status transitions: `pending_payment` → `confirmed` → `completed`<br>Payment recorded with correct `paymentType`<br>Confirmation email triggered<br>Remaining balance = totalPrice - depositPaid |
| QA-02 | Manual payment: create booking → register deposit → register final payment | 1. Create booking<br>2. `createManualPayment` with amount < remainingBalance<br>3. `createManualPayment` with amount = remainingBalance | First payment: `paymentType=deposit`, booking `confirmed`<br>Second payment: `paymentType=final_payment`, booking `fully_paid` |
| QA-03 | Booking creation with customer lookup | 1. Create customer via public form<br>2. Create second booking with same phone+name | Second booking reuses existing customer (no duplicate) |

### 2. Payment Notifications

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-10 | Booking created → customer received email | Create booking with customer email | `sendBookingReceivedToCustomer` called with correct booking data |
| QA-11 | Booking confirmed → customer confirmation email | Apply payment + `confirmPayment` with `wasConfirmed=true` | `sendBookingConfirmedNotification` called once |
| QA-12 | Booking cancelled → customer cancellation email | `updateBookingStatus` to `cancelled` | `sendBookingCancelledNotification` called with correct service/time |
| QA-13 | Payment confirmed but booking already confirmed → no duplicate email | Call `confirmPayment` twice | `sendBookingConfirmedNotification` called only on first call |

### 3. Error States

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-20 | Create booking with invalid service | Submit form with non-existent serviceId | 400 + error message |
| QA-21 | Create booking with past date | Submit form with startDateTime in past | 400 + validation error |
| QA-22 | Create booking with unavailable slot | Create booking, then create second booking for same slot | Second booking fails with slot unavailable error |
| QA-23 | Register payment exceeding remaining balance | Call `createManualPayment` with amount > remainingBalance | Error: `El monto excede el saldo pendiente` |
| QA-24 | Register payment with mismatched paymentType | Client sends `paymentType=deposit` but server derives `full_payment` | Error: `Tipo de pago incompatible` |
| QA-25 | Confirm payment for non-existent booking | Call `confirmPayment` with random UUID | ForbiddenError: `Reserva no encontrada` |
| QA-26 | Update booking to invalid status transition | Try to change `completed` → `confirmed` | ForbiddenError: invalid transition |

### 4. Edge Cases

| ID | Scenario | Steps | Expected |
|----|----------|-------|----------|
| QA-30 | Booking at business closing time | Create service with 60min duration, book at 23:00 | End time wraps to next day — handled gracefully |
| QA-31 | Payment with exact remaining balance | Create booking with remainingBalance=5000, pay 5000 | Derives `full_payment` when depositPaid=0, `final_payment` when depositPaid>0 |
| QA-32 | Customer with no email | Create booking with customerEmail=null | No `sendBookingReceivedToCustomer` call (guarded by null check) |
| QA-33 | Idempotent booking creation | Create booking with same idempotencyKey twice | Returns existing booking (no duplicate created) |
| QA-34 | Multiple rapid payment attempts | Call `createManualPayment` twice rapidly for same booking | Second call succeeds (idempotency via paymentId) |

---

## Test Execution

Run with:
```bash
npm run test:e2e
```

Run with UI:
```bash
npm run test:e2e:ui
```

Run integration tests only:
```bash
npm run test:integration
```

---

## Coverage Goals

- ✅ Booking creation (public form)
- ✅ Payment confirmation flow
- ✅ Manual payment registration
- ✅ Status transitions
- ✅ Notification triggers (email + business)
- ✅ Error handling for invalid inputs
- ✅ Idempotency (booking + payment)
- ✅ Edge: zero remaining balance, exact match payments, missing customer data