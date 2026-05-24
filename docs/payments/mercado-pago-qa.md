# Mercado Pago QA — Sandbox Testing

## Status: ⏳ PENDING — Sandbox not yet executed

This document defines the end-to-end test cases required to validate the Mercado Pago integration before going to production. **Prompt 06 is NOT complete until these tests are executed with real sandbox credentials.**

---

## Prerequisites

Before running these tests, you need:

1. **Mercado Pago Developer Account** — [mercadopago.com.ar/developers](https://mercadopago.com.ar/developers)
2. **Test User** — Create a test buyer and seller in the Mercado Pago developer dashboard
3. **Application ID** — From your MP developer app credentials
4. **Access Token** — From MP developer dashboard → Gestión de credenciales → Producción (or Prueba)
5. **Webhook URL** — Must be publicly accessible (not localhost). Use a tunneling tool like `ngrok` for local testing.

---

## Test Environment Variables Required

```bash
PAYMENT_PROVIDER=mercado_pago
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...      # from MP developer dashboard
MERCADO_PAGO_WEBHOOK_SECRET=...            # from MP webhook config
NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY=APP_USR-...  # from MP developer dashboard
ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=false
```

---

## Test Case Specifications

### TC-01: Booking Creation → Mercado Pago Redirect

**Objective**: Verify that when a customer books and pays via Mercado Pago, the flow redirects correctly to MP checkout.

**Steps**:
1. Navigate to `/book/{businessSlug}`
2. Select a service
3. Select a date and time
4. Fill in customer name, phone, email
5. Click "Continuar al pago"
6. Observe redirect to Mercado Pago sandbox URL

**Expected**:
- Redirect URL contains `mercadopago.com` or sandbox equivalent
- `external_reference` or similar field contains the booking ID
- Amount matches the service deposit amount

**Validation**: Check browser network tab for the MP redirect URL.

---

### TC-02: Webhook — Payment Approved → Booking Confirmed

**Objective**: Verify that when Mercado Pago sends an `payment_approved` webhook, the booking transitions to `confirmed` and a ledger entry is created.

**Steps**:
1. Create a booking (TC-01) but do not complete payment
2. Use Mercado Pago's webhook testing tool or `ngrok` to manually fire an `payment_approved` webhook
3. The webhook payload should include:
   - `action: payment.approved`
   - `data.id` with a valid payment ID
   - `external_reference` matching the booking ID

**Expected**:
- `booking.status` → `confirmed`
- `booking.depositPaid` updated correctly
- `booking.paymentStatus` → `deposit_paid`
- `Payment` record created with `status=approved`
- `LedgerEntry` created with correct type (`deposit_paid`)
- `sendBookingConfirmedNotification` triggered
- No duplicate ledger entries on repeated webhook delivery

**Validation**:
```bash
# Check DB state
psql $DATABASE_URL -c "SELECT id, status, depositPaid FROM booking WHERE id='{bookingId}'"
psql $DATABASE_URL -c "SELECT id, bookingId, status, paymentType FROM payment ORDER BY createdAt DESC LIMIT 5"
psql $DATABASE_URL -c "SELECT id, bookingId, type, direction FROM ledger_entry ORDER BY createdAt DESC LIMIT 5"
```

---

### TC-03: Webhook Idempotency — Duplicate `payment.approved` Ignored

**Objective**: Verify that sending the same webhook twice does not create duplicate ledger entries or double-credit the booking.

**Steps**:
1. Complete TC-02 and verify booking is confirmed
2. Re-send the same `payment.approved` webhook with identical `data.id`
3. Check database for payment and ledger entry counts

**Expected**:
- Payment with same `providerPaymentId` already exists → webhook returns 200 without side effects
- `booking.depositPaid` unchanged from first confirmation
- No second `LedgerEntry` created

---

### TC-04: Webhook — Invalid Signature Rejected

**Objective**: Verify that webhook requests with invalid HMAC signatures are rejected with 400/401 and no state changes.

**Steps**:
1. Send a webhook request to `/api/webhooks/mercado-pago` with:
   - Wrong `x-signature` header (e.g., `ts=123,v1=invalidsignature`)
   - Valid-looking but incorrect payload

**Expected**:
- Endpoint returns 400 or 401
- No `Payment` or `LedgerEntry` records created
- Log entry with `webhook.rejected` event

**Validation**:
```bash
curl -X POST https://yourdomain.com/api/webhooks/mercado-pago \
  -H "x-signature: ts=123,v1=badsignature" \
  -H "Content-Type: application/json" \
  -d '{"action":"payment.approved","data":{"id":"1234567890"}}'
# Expected: HTTP 400 or 401
```

---

### TC-05: Webhook — Wrong Amount / Currency Rejected

**Objective**: Verify that a webhook with mismatched amount or currency is rejected and does not update booking state.

**Steps**:
1. Create a booking with expected deposit of 10000 CLP
2. Send a webhook with:
   - `transaction_amount: 5000` (wrong amount)
   - or `currency_id: "USD"` (wrong currency)

**Expected**:
- Webhook accepted but booking not updated
- Error logged with `webhook.rejected` event and reason (amount mismatch)
- No state changes in DB

---

### TC-06: Webhook — `external_reference` Not Found → Rejected

**Objective**: Verify that a webhook referencing a non-existent booking ID is rejected.

**Steps**:
1. Send webhook with `external_reference: "non-existent-booking-id"`

**Expected**:
- Returns 200 (MP requires 200 to stop retrying) but no state changes
- Error logged: "Reserva no encontrada para external_reference"

---

### TC-07: Payment Failure → Booking Stays `pending_payment`

**Objective**: Verify that a failed/cancelled payment does not confirm the booking.

**Steps**:
1. Create a booking
2. Simulate a `payment.failed` or `payment.cancelled` webhook
3. Check booking status remains `pending_payment`

**Expected**:
- `booking.status` → still `pending_payment`
- No `Payment` record with `status=approved`
- Customer notification not sent (or `sendBookingFailedNotification` if implemented)

---

### TC-08: Redirect Success — No Confirmation Without Webhook

**Objective**: Verify that returning from Mercado Pago without a webhook does NOT confirm the booking (webhook is the only confirmation path).

**Steps**:
1. Create a booking and initiate payment
2. Close the browser before completing payment
3. Use MP's redirect URL (return_url) to return to the confirmation page without payment completion
4. Check booking status

**Expected**:
- Booking remains `pending_payment`
- No `Payment` record created
- UI shows appropriate "pending payment" state

---

### TC-09: Full E2E — Booking → Payment → Confirmation → Cancel

**Objective**: End-to-end test covering the complete lifecycle.

**Steps**:
1. Create booking for a future date
2. Pay via Mercado Pago sandbox (simulate approved)
3. Receive webhook → booking confirmed
4. Business owner marks as `completed`
5. Business owner cancels a different booking
6. Verify:
   - Confirmed booking has correct ledger entries
   - Cancelled booking triggers `sendBookingCancelledNotification`
   - `LedgerEntry` with `cancellation_fee_charged` type created (if configured)

---

## Known Blockers

The following must be resolved before TC-04 (webhook signature validation) can be tested in a public environment:

1. **Ngrok/Public URL required** — Webhook testing requires a publicly accessible URL. Localhost cannot receive MP webhook callbacks.
2. **Production credentials** — Sandbox testing should use Mercado Pago's test credentials, not production ones.
3. **Webhook URL registration** — The URL `https://yourdomain.com/api/webhooks/mercado-pago` must be registered in the MP developer dashboard under "Webhooks" → "Notificaciones de pago".

---

## Checklist to Mark Prompt 06 as DONE

- [ ] All 9 test cases above executed
- [ ] All assertions pass
- [ ] DB state verified after each test
- [ ] Logs reviewed for `webhook.received`, `webhook.approved`, `webhook.rejected` events
- [ ] No duplicate payments or ledger entries
- [ ] Signature validation tested with both valid and invalid signatures
- [ ] Sandbox credentials verified working end-to-end