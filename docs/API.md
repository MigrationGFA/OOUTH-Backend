# OOUTH API

Base URL: `http://localhost:4000/api`. Swagger UI: `/api/docs`.

Every JSON response is `{ "data": ... }` or `{ "error": { "code": "", "message": "" } }`. Times are ISO-8601. Amounts are naira. The hospital zone is `Africa/Lagos`.

Signed-in routes read the `oouth_access` cookie. `POST /api/auth/refresh` rotates the `oouth_refresh` cookie. Both cookies are httpOnly and SameSite=lax.

## Shared errors

| Status | Code | When |
| --- | --- | --- |
| 400 | `validation_error` | Zod rejected the body, or a clinical rule rejected the values |
| 401 | `unauthorized` | Missing or expired access cookie, or login failed |
| 403 | `forbidden` | The signed-in role cannot perform the action |
| 404 | `not_found` | The record does not exist |
| 409 | `conflict` | Duplicate email, slot, revision, dose, or rating |
| 429 | rate limit | More than 30 register, login, or password-reset requests in 15 minutes |
| 500 | `internal_error` | Unexpected failure |

A route below lists only the errors that are specific to it. The shared errors still apply.

## Health

### GET /api/health

- Purpose: confirm the process is answering.
- Permission: public.
- Request body: none.
- Response example: `{ "data": { "ok": true } }`
- Errors: 500.

## Authentication

### POST /api/auth/register

- Purpose: create a patient and a patient number.
- Permission: public, rate limited.
- Request body: `{ "firstName": "Ada", "lastName": "Okoye", "email": "ada@example.com", "phone": "08030000000", "dateOfBirth": "1990-01-01", "gender": "female", "address": "Sagamu", "password": "patient-secret" }`
- Response example: `{ "data": { "id": "uuid", "role": "patient", "email": "ada@example.com", "patientNumber": "OOUTH-P-2026-0001" } }`
- Errors: 409 when the email is already registered. Sets session cookies.

### POST /api/auth/login

- Purpose: open a session.
- Permission: public, rate limited.
- Request body: `{ "email": "ada@example.com", "password": "patient-secret" }`
- Response example: `{ "data": { "id": "uuid", "role": "patient", "email": "ada@example.com" } }`
- Errors: 401 `unauthorized` with the same message for an unknown email and a wrong password.

### POST /api/auth/logout

- Purpose: revoke the refresh session and clear both cookies.
- Permission: public. A missing cookie still clears the browser cookies.
- Request body: none.
- Response example: `{ "data": { "ok": true } }`
- Errors: none specific.

### POST /api/auth/refresh

- Purpose: rotate the refresh cookie and issue a new access cookie.
- Permission: valid `oouth_refresh` cookie.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "role": "patient" } }`
- Errors: 401 when the refresh cookie is missing, expired, or already rotated.

### POST /api/auth/password-reset

- Purpose: record a reset token and send mail when SMTP accepts it.
- Permission: public, rate limited.
- Request body: `{ "email": "ada@example.com" }`
- Response example: `{ "data": { "ok": true } }` with status 202, whether or not the email exists.
- Errors: 400 when the email field is invalid. Always 202 for a well-formed email.

### POST /api/auth/password-reset/confirm

- Purpose: set a new password from a reset token.
- Permission: public.
- Request body: `{ "token": "reset-token", "password": "new-secret" }`
- Response example: `{ "data": { "ok": true } }`
- Errors: 400 when the token is unknown or expired.

### GET /api/auth/me

- Purpose: return the signed-in user.
- Permission: any signed-in user.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "role": "patient", "email": "ada@example.com", "patientNumber": "OOUTH-P-2026-0001" } }`
- Errors: 401.

### POST /api/auth/change-password

- Purpose: replace the signed-in user's password.
- Permission: any signed-in user.
- Request body: `{ "currentPassword": "old-secret", "nextPassword": "new-secret" }`
- Response example: `{ "data": { "ok": true } }`
- Errors: 401 when the current password is wrong.

## Patients

### GET /api/patients/me

- Purpose: same profile as `GET /api/auth/me`.
- Permission: any signed-in user.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "role": "patient", "firstName": "Ada" } }`
- Errors: 401.

### PATCH /api/patients/me

- Purpose: update the signed-in patient's own profile.
- Permission: `patient`.
- Request body: `{ "firstName": "Ada", "lastName": "Okoye", "phone": "08030000000", "address": "Sagamu", "gender": "female", "dateOfBirth": "1990-01-01" }`
- Response example: `{ "data": { "id": "uuid", "firstName": "Ada" } }`
- Errors: 403 for any other role.

### GET /api/patients/:id/records

- Purpose: list clinical notes for a patient. Patients see only notes shared with them. Administrators receive an empty list.
- Permission: the patient, or a consultant who can see that patient's visits.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "notes": "Stable.", "sharedWithPatient": true }] }`
- Errors: 403 when a patient asks for another patient's notes.

### POST /api/patients/:id/allergies

- Purpose: append an allergy. Allergies are not deleted.
- Permission: the patient, a consultant with a visit for that patient, or the super consultant.
- Request body: `{ "substance": "Penicillin", "reaction": "Rash" }`
- Response example: `{ "data": { "id": "uuid", "substance": "Penicillin", "reaction": "Rash" } }`
- Errors: 403 when the caller cannot write for that patient.

### GET /api/patients/:id/allergies

- Purpose: list allergies, newest first.
- Permission: the patient, or any signed-in clinical role reading that patient.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "substance": "Penicillin" }] }`
- Errors: 403 when a patient asks for another patient's list.

## Departments and consultants

### GET /api/departments

- Purpose: list departments that are not soft-deleted.
- Permission: public.
- Query: `group`, `booking=true|false`.
- Request body: none.
- Response example: `{ "data": [{ "slug": "cardiology", "name": "Cardiology", "patientBooking": true }] }`
- Errors: none specific.

### GET /api/departments/:slug/slots

- Purpose: list open super-consultant slots for one Lagos calendar date.
- Permission: public.
- Query: `date=2026-11-12`, `visit=physical|virtual`.
- Request body: none.
- Response example: `{ "data": [{ "startsAt": "2026-11-12T07:00:00.000Z", "endsAt": "2026-11-12T08:00:00.000Z" }] }`
- Errors: 404 when the department slug does not exist. An empty array means the day is closed or fully booked.

### GET /api/consultants

- Purpose: list consultant profiles.
- Permission: public.
- Query: `department`, `booking=true|false`.
- Request body: none.
- Response example: `{ "data": [{ "slug": "super_consultant", "name": "Super Consultant", "onlineBookingEnabled": true }] }`
- Errors: none specific.

### GET /api/consultants/:slug

- Purpose: read one consultant.
- Permission: public.
- Request body: none.
- Response example: `{ "data": { "slug": "super_consultant", "name": "Super Consultant" } }`
- Errors: 404.

### PUT /api/consultants/:slug/availability

- Purpose: replace the weekly schedule for a consultant.
- Permission: that consultant, or an administrator.
- Request body: `{ "days": [1, 2, 3, 4, 5], "startTime": "08:00", "endTime": "16:00", "durationMinutes": 60, "breaks": [], "blockedDates": [], "physicalEnabled": true, "virtualEnabled": true }`
- Response example: `{ "data": { "consultantSlug": "super_consultant", "startTime": "08:00", "durationMinutes": 60 } }`
- Errors: 403 for a different consultant.

## Appointments

### POST /api/appointments

- Purpose: book a slot with the super consultant. The slot stays pending until payment is verified.
- Permission: `patient`.
- Request body: `{ "departmentSlug": "cardiology", "consultationType": "virtual", "startsAt": "2026-11-12T07:00:00.000Z", "reason": "Chest discomfort", "symptoms": "", "medicalHistory": "", "privacyConsent": true, "telemedicineConsent": true }`
- Response example: `{ "data": { "id": "uuid", "reference": "OOUTH-APT-2026-0001", "status": "pending_payment" } }`
- Errors: 409 when that consultant slot is already held. 400 when consent is missing.

### GET /api/appointments

- Purpose: list appointments the caller is allowed to see.
- Permission: any signed-in user. Patients see their own. Consultants see assigned visits. The super consultant and administrator see the hospital list. Administrators do not receive clinical narrative.
- Query: `status`, `date`, `page`, `pageSize`.
- Request body: none.
- Response example: `{ "data": { "items": [], "page": 1, "pageSize": 20, "total": 0 } }`
- Errors: 401.

### GET /api/appointments/:id

- Purpose: read one appointment.
- Permission: a user who can see that appointment.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "status": "pending_payment", "amountNaira": 50000 } }`
- Errors: 403, 404.

### POST /api/appointments/:id/cancel

- Purpose: cancel a visit and release its slot.
- Permission: the patient, the assigned consultant, or an administrator.
- Request body: `{ "reason": "No longer needed" }`
- Response example: `{ "data": { "id": "uuid", "status": "cancelled" } }`
- Errors: 400 when the reason is shorter than two characters, or the notice window has closed.

### POST /api/appointments/:id/reschedule

- Purpose: move a visit. A paid patient request holds the new time until the 10% fee is verified. A consultant move, or an unpaid visit, applies immediately.
- Permission: the patient or the assigned consultant.
- Request body: `{ "startsAt": "2026-11-13T07:00:00.000Z" }`
- Response example: `{ "data": { "pending": true, "feeNaira": 3000 } }`
- Errors: 409 when the new slot is taken. 403 outside the notice window.

### POST /api/appointments/:id/status

- Purpose: mark a confirmed visit in progress, completed, or no-show.
- Permission: the assigned consultant or the super consultant.
- Request body: `{ "status": "in_progress" }`
- Response example: `{ "data": { "id": "uuid", "status": "in_progress" } }`
- Errors: 403 when payment is not verified.

### POST /api/appointments/:id/direct

- Purpose: send a super-consultant visit to another consultant.
- Permission: the super consultant.
- Request body: `{ "consultantSlug": "demo-consultant-a" }`
- Response example: `{ "data": { "id": "uuid", "consultantSlug": "demo-consultant-a" } }`
- Errors: 403 for any other caller.

### POST /api/appointments/:id/triage

- Purpose: assign a department, consultant, and time to a visit that is waiting for triage.
- Permission: desk officer, administrator, or the super consultant.
- Request body: `{ "departmentSlug": "cardiology", "consultantSlug": "demo-consultant-a", "startsAt": "2026-11-12T08:00:00.000Z", "endsAt": "2026-11-12T09:00:00.000Z" }`
- Response example: `{ "data": { "id": "uuid", "status": "pending_payment", "consultantSlug": "demo-consultant-a" } }`
- Errors: 403, 404. Status becomes `confirmed` when payment is already verified.

### POST /api/appointments/:id/presence

- Purpose: set the waiting-room present flag for the video screen.
- Permission: the patient or the assigned consultant.
- Request body: `{ "present": true }`
- Response example: `{ "data": { "id": "uuid", "patientPresent": true } }`
- Errors: 403.

### POST /api/appointments/:id/video-token

- Purpose: return a short-lived HMAC token after a verified virtual payment, inside the join window. It does not open a third-party room and does not enable recording.
- Permission: the patient or the assigned consultant.
- Request body: none.
- Response example: `{ "data": { "token": "hmac-token", "expiresAt": "2026-11-12T07:15:00.000Z", "recording": false } }`
- Errors: 403 when the visit is not virtual, payment is unverified, or the join window is closed.

### PUT /api/appointments/:id/record

- Purpose: append a clinical note. Notes are not overwritten.
- Permission: the assigned consultant or the super consultant.
- Request body: `{ "notes": "Stable.", "diagnosis": "", "treatment": "", "prescription": "", "sharedWithPatient": false }`
- Response example: `{ "data": { "id": "uuid", "notes": "Stable." } }`
- Errors: 403.

### PATCH /api/appointments/:id/encounter

- Purpose: save changed consultation fields. The same idempotency key returns the stored draft.
- Permission: the assigned consultant or the super consultant.
- Request body: `{ "expectedRevision": 0, "idempotencyKey": "draft-key-1", "chiefComplaint": "Chest discomfort" }`
- Response example: `{ "data": { "revision": 1, "fields": { "chiefComplaint": "Chest discomfort" }, "duplicate": false } }`
- Errors: 409 when `expectedRevision` is stale.

### POST /api/appointments/:id/encounter/sign

- Purpose: sign the consultation. The same idempotency key returns the existing signature. Signing creates the journey, pharmacy lines, and investigation orders.
- Permission: the assigned consultant or the super consultant. Payment must be verified.
- Request body: `{ "baseVersion": 0, "idempotencyKey": "sign-key-1", "chiefComplaint": "Chest discomfort", "assessment": "Stable", "plan": "Review" }`
- Response example: `{ "data": { "id": "uuid", "version": 1, "reportReference": "OOUTH-TC-2026-0001", "duplicate": false } }`
- Errors: 403 when payment is unverified or validation fails. 409 when `baseVersion` is stale or an amendment has no changes.

### GET /api/appointments/:id/encounter

- Purpose: read the latest signed encounter and the current draft.
- Permission: a user who can see the appointment. Pharmacy and laboratory roles do not receive the narrative.
- Request body: none.
- Response example: `{ "data": { "encounter": null, "draft": { "revision": 1, "body": {} } } }`
- Errors: 403, 404.

### GET /api/appointments/:id/consultation-report

- Purpose: read the signed consultation report.
- Permission: the patient when the note is shared, or the assigned consultant.
- Request body: none.
- Response example: `{ "data": { "reference": "OOUTH-TC-2026-0001", "sections": [] } }`
- Errors: 404 when nothing has been signed.

## Payments

### POST /api/payments/initialize

- Purpose: create a Paystack authorization for an appointment. The secret stays on the server. The callback is `{FRONTEND_ORIGIN}/patient/payments/return`.
- Permission: the patient who owns the appointment.
- Request body: `{ "appointmentId": "uuid" }`
- Response example: `{ "data": { "authorizationUrl": "https://checkout.paystack.com/example", "reference": "OOUTH-PAY-1" } }`
- Errors: 503 `payment_unavailable` when `PAYSTACK_SECRET_KEY` is empty. 403 for another patient's appointment.

### POST /api/payments/verify

- Purpose: confirm a Paystack reference and confirm the appointment once.
- Permission: the patient who owns the payment.
- Request body: `{ "reference": "OOUTH-PAY-1" }`
- Response example: `{ "data": { "status": "verified", "appointmentId": "uuid", "duplicate": false } }`
- Errors: 503 `payment_unavailable`. A second verify of the same successful reference returns `duplicate: true` and does not confirm the appointment twice.

### POST /api/payments/webhook

- Purpose: accept a Paystack webhook. The raw body is checked with HMAC SHA512 against `x-paystack-signature`.
- Permission: Paystack signature. No session cookie.
- Request body: the Paystack event JSON.
- Response example: `{ "data": { "ok": true } }`
- Errors: 401 when the signature does not match.

## Documents, catalog, and encounters

### POST /api/documents

- Purpose: store a JPG, PNG, or PDF up to 400 KB in PostgreSQL.
- Permission: the patient or the assigned consultant.
- Request body: multipart field `file`, plus `appointmentId` and `sharedWithPatient`.
- Response example: `{ "data": { "id": "uuid", "name": "result.pdf", "mimeType": "application/pdf" } }`
- Errors: 400 for a missing file or a type that is not allowed.

### GET /api/documents

- Purpose: list document metadata the caller can see. Bytes are omitted.
- Permission: any signed-in user, filtered to their visits.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "name": "result.pdf" }] }`
- Errors: 401.

### GET /api/catalog/:kind

- Purpose: list a clinical catalog. `kind` is `medications`, `diagnoses`, `imaging-studies`, or `laboratory-tests`.
- Permission: consultant, administrator, pharmacist, or laboratory officer.
- Request body: none.
- Response example: `{ "data": [{ "code": "PARA-500", "name": "Paracetamol" }] }`
- Errors: 403.

### GET /api/encounters/:id/handoff

- Purpose: build a handoff card for one signed encounter.
- Permission: a clinician who can see the encounter.
- Query: `audience`.
- Request body: none.
- Response example: `{ "data": { "title": "Handoff", "lines": [] } }`
- Errors: 404.

### POST /api/encounters/:id/demo-email

- Purpose: email the shared note when SMTP accepts it. Otherwise it is stored as an in-app notice.
- Permission: the consultant who signed the encounter, or the patient when the note is shared.
- Request body: none.
- Response example: `{ "data": { "delivered": false } }`
- Errors: 403, 404.

### POST /api/encounters/:appointmentId/operations

- Purpose: acknowledge that pharmacy lines and investigation orders are created at sign time.
- Permission: the assigned consultant.
- Request body: none.
- Response example: `{ "data": { "ok": true, "message": "Pharmacy lines and investigation orders are created when the consultation is signed." } }`
- Errors: 401.

## Notifications, dashboards, and workspace

### GET /api/notifications

- Purpose: list the caller's latest notices.
- Permission: any signed-in user.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "title": "Visit confirmed", "read": false }] }`
- Errors: 401.

### POST /api/notifications/:id/read

- Purpose: mark one of the caller's notices as read.
- Permission: the owner of the notice.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "read": true } }`
- Errors: 404.

### GET /api/dashboards/:role/summary

- Purpose: return counts for the caller's own role home.
- Permission: the signed-in user's role must equal `:role`.
- Request body: none.
- Response example: `{ "data": { "total": 3, "today": 1, "pendingPayment": 1 } }`
- Errors: 403 when `:role` is not the caller's role.

### GET /api/session/workspace

- Purpose: return one role-filtered snapshot for the browser cache. Hidden collections are empty arrays.
- Permission: any signed-in user.
- Request body: none.
- Response example: `{ "data": { "users": [], "appointments": [], "encounters": [], "departments": [] } }`
- Errors: 401.

## Desk

Desk payments are a hospital ledger. They do not call Paystack.

### POST /api/desk/patients

- Purpose: register a walk-in patient and return the generated password once.
- Permission: `desk_officer`.
- Request body: `{ "firstName": "Tunde", "lastName": "Adebayo", "dateOfBirth": "1985-04-02", "gender": "male", "phone": "08031111111", "address": "Ijebu Ode", "email": "" }`
- Response example: `{ "data": { "id": "uuid", "patientNumber": "OOUTH-P-2026-0002", "password": "Desk#22026" } }`
- Errors: 403.

### PATCH /api/desk/patients/:id

- Purpose: correct a desk-registered patient's demographic fields.
- Permission: desk officer or administrator.
- Request body: `{ "phone": "08032222222", "address": "Sagamu" }`
- Response example: `{ "data": { "id": "uuid", "phone": "08032222222" } }`
- Errors: 404.

### POST /api/desk/visits

- Purpose: open a walk-in visit and a queue journey.
- Permission: `desk_officer`.
- Request body: `{ "patientId": "uuid", "departmentSlug": "cardiology", "consultantSlug": "super_consultant", "consultationType": "physical", "reason": "Walk-in review" }`
- Response example: `{ "data": { "appointmentId": "uuid", "journeyId": "uuid", "reference": "OOUTH-APT-2026-0003" } }`
- Errors: 404 when the patient does not exist.

### POST /api/desk/patients/:id/payments

- Purpose: record a desk payment for registration and consultation.
- Permission: `desk_officer`.
- Request body: `{ "durationHours": 1, "status": "paid", "amountReceived": 50000, "appointmentId": "uuid" }`
- Response example: `{ "data": { "id": "uuid", "status": "paid", "totalNaira": 50000 } }`
- Errors: 400 when the amount does not match the fee. 404.

### POST /api/desk/appointments/:id/check-in

- Purpose: check a paid visit into the queue.
- Permission: `desk_officer`.
- Request body: `{ "mode": "check_in" }` or `{ "mode": "early", "overrideReason": "Ambulance arrival" }`
- Response example: `{ "data": { "appointmentId": "uuid", "queueStatus": "waiting" } }`
- Errors: 403 when payment is not recorded. 400 when an early check-in has no reason.

### POST /api/desk/appointments/:id/status

- Purpose: set a desk appointment status. Cancellation and no-show require a reason. Cancellation releases the slot.
- Permission: `desk_officer`.
- Request body: `{ "status": "cancelled", "reason": "Patient left" }`
- Response example: `{ "data": { "id": "uuid", "status": "cancelled" } }`
- Errors: 400 when a cancellation or no-show has no reason.

### POST /api/desk/requests/:id/collect

- Purpose: mark a pharmacy, laboratory, or imaging request as collected by a desk runner.
- Permission: desk runner `OOUTH-S-DESK-2` or `OOUTH-S-DESK-3`.
- Request body: `{ "kind": "pharmacy" }`
- Response example: `{ "data": { "id": "uuid", "collectedAt": "2026-11-12T09:00:00.000Z" } }`
- Errors: 403 for any other staff id.

### POST /api/desk/journeys/:id/status

- Purpose: move a journey along the desk queue.
- Permission: `desk_officer`.
- Request body: `{ "queueStatus": "waiting", "reason": "" }`
- Response example: `{ "data": { "id": "uuid", "queueStatus": "waiting" } }`
- Errors: 400 when the transition is not allowed.

### GET /api/desk/journeys

- Purpose: list recent journeys.
- Permission: desk officer, administrator, or consultant.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "queueStatus": "awaiting_payment" }] }`
- Errors: 403.

### GET /api/desk/payments

- Purpose: list recent desk payments.
- Permission: desk officer, administrator, or consultant.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "status": "pending", "totalNaira": 50000 }] }`
- Errors: 403.

## Pharmacy

### GET /api/pharmacy/dispenses

- Purpose: list prescription lines.
- Permission: pharmacist or administrator.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "medicationName": "Paracetamol", "status": "pending_pharmacy" }] }`
- Errors: 403.

### POST /api/pharmacy/dispenses/:id

- Purpose: verify, review, clarify, dispense, or cancel one line. A dispense decrements matching stock once.
- Permission: `pharmacist`.
- Request body: `{ "action": "full", "quantity": 1, "instructions": "After food", "substitution": "", "clarification": "" }`
- Response example: `{ "data": { "id": "uuid", "status": "dispensed", "quantityDispensed": 1 } }`
- Errors: 400 when stock is short or the action is not allowed for the current status. 404.

### GET /api/pharmacy/inventory

- Purpose: list inventory that is not soft-deleted.
- Permission: pharmacist or administrator.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "name": "Paracetamol", "quantity": 100 }] }`
- Errors: 403.

### POST /api/pharmacy/inventory

- Purpose: create or update a stock item.
- Permission: pharmacist or administrator.
- Request body: `{ "name": "Paracetamol", "category": "Analgesic", "quantity": 80, "unit": "tablet", "reorderLevel": 20 }`
- Response example: `{ "data": { "id": "uuid", "name": "Paracetamol", "quantity": 80 } }`
- Errors: 403.

## Diagnostics

### GET /api/diagnostics/orders

- Purpose: list investigation orders.
- Permission: laboratory officer, consultant, or administrator.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "name": "Full blood count", "status": "ordered" }] }`
- Errors: 403.

### POST /api/diagnostics/orders/:id

- Purpose: advance an order, or let the assigned consultant record an interpretation and release it.
- Permission: laboratory officer for processing. The assigned consultant, or the super consultant, for interpretation and release.
- Request body: `{ "status": "result_available", "resultText": "Within range", "resultFileName": "fbc.pdf" }`
- Response example: `{ "data": { "id": "uuid", "status": "result_available", "resultText": "Within range" } }`
- Errors: 403, 404.

## Nursing

### POST /api/nursing/administrations

- Purpose: append a medication administration. The row is not updated later.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid", "appointmentId": "uuid", "encounterId": "uuid", "medicationItemId": "med-1", "medicationName": "Paracetamol", "outcome": "administered", "dose": "1 g", "route": "oral", "scheduledFor": "2026-11-12T08:00", "confirmed": true }`
- Response example: `{ "data": { "id": "uuid", "outcome": "administered" } }`
- Errors: 400 when `confirmed` is false, or a non-administered outcome has no reason. 409 when that scheduled dose is already recorded.

### POST /api/nursing/observation-orders

- Purpose: set the active observation level. The previous active order is closed.
- Permission: `consultant`.
- Request body: `{ "patientId": "uuid", "level": "L2", "intervalMinutes": 60, "instructions": "Call if pain increases" }`
- Response example: `{ "data": { "id": "uuid", "level": "L2", "active": true } }`
- Errors: 403.

### POST /api/nursing/observations

- Purpose: append an observation. The next due time follows the active order.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid", "readings": [{ "name": "Pulse", "value": "80", "unit": "bpm" }], "note": "", "behaviour": "Calm", "risk": "low" }`
- Response example: `{ "data": { "id": "uuid", "risk": "low", "nextDueAt": "2026-11-12T10:00:00.000Z" } }`
- Errors: 403.

### POST /api/nursing/handovers

- Purpose: save, submit, or amend a shift handover. A submitted handover is not overwritten.
- Permission: `nurse`.
- Request body: `{ "shiftId": "uuid", "generalSummary": "Ward quiet.", "mode": "submit" }`
- Response example: `{ "data": { "id": "uuid", "status": "submitted" } }`
- Errors: 409 when the caller tries to overwrite a submitted handover.

### POST /api/nursing/handovers/:id/acknowledge

- Purpose: acknowledge another nurse's handover.
- Permission: `nurse`, and not the author.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "status": "acknowledged" } }`
- Errors: 403 when the author tries to acknowledge it. 404.

### POST /api/nursing/shifts

- Purpose: start a shift.
- Permission: `nurse`.
- Request body: `{ "wardId": "ward_medical_a" }`
- Response example: `{ "data": { "id": "uuid", "wardId": "ward_medical_a", "endedAt": null } }`
- Errors: 409 when this nurse already has an open shift.

### POST /api/nursing/shifts/:id/end

- Purpose: end the caller's shift.
- Permission: the nurse who started it.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "endedAt": "2026-11-12T16:00:00.000Z" } }`
- Errors: 403, 404.

### POST /api/nursing/beds/:id/assign

- Purpose: place a patient on a bed or clear it.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid" }` or `{ "patientUserId": null }`
- Response example: `{ "data": { "id": "bed-id", "patientUserId": "uuid" } }`
- Errors: 404.

### POST /api/nursing/admissions

- Purpose: admit a patient to a bed.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid", "wardId": "ward_medical_a", "bedId": "uuid", "consultantSlug": "super_consultant", "diagnosisLabel": "Observation", "plan": "Monitor" }`
- Response example: `{ "data": { "id": "uuid", "dischargeStatus": "admitted" } }`
- Errors: 409 when the bed is occupied.

### POST /api/nursing/admissions/:id/status

- Purpose: mark an admission ready or discharged. Discharge clears the bed.
- Permission: nurse or consultant.
- Request body: `{ "dischargeStatus": "discharged" }`
- Response example: `{ "data": { "id": "uuid", "dischargeStatus": "discharged" } }`
- Errors: 404.

### POST /api/nursing/tasks

- Purpose: create or update a nursing task.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid", "description": "Collect sample", "priority": "routine", "dueAt": "2026-11-12T12:00:00.000Z", "status": "open", "completionNote": "" }`
- Response example: `{ "data": { "id": "uuid", "status": "open" } }`
- Errors: 403.

### GET /api/nursing/:kind

- Purpose: list one nursing collection. `kind` is `observations`, `observationOrders`, `tasks`, `shifts`, `handovers`, `wards`, `beds`, `admissions`, or `administrations`.
- Permission: nurse, consultant, or administrator.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid" }] }`
- Errors: 403, or 404 when `kind` is unknown.

### POST /api/nursing/allergies/:patientId/none

- Purpose: record that the patient has no known allergies.
- Permission: `nurse`.
- Request body: none.
- Response example: `{ "data": { "id": "uuid", "allergyStatus": "none_known" } }`
- Errors: 409 when allergies are already recorded.

### POST /api/nursing/clarifications

- Purpose: send a medication clarification to the consultant. The prescription is not changed.
- Permission: `nurse`.
- Request body: `{ "patientUserId": "uuid", "consultantSlug": "super_consultant", "medicationName": "Paracetamol", "note": "Confirm the dose" }`
- Response example: `{ "data": { "id": "uuid", "title": "Medication clarification" } }`
- Errors: 400 when the note is empty.

## Ratings and administration

### POST /api/ratings

- Purpose: rate one completed visit. One rating per appointment.
- Permission: the patient who attended.
- Request body: `{ "appointmentId": "uuid", "overall": 5, "communication": 5, "professionalism": 5, "attention": 4, "feedback": "Clear explanation." }`
- Response example: `{ "data": { "id": "uuid", "overall": 5 } }`
- Errors: 403 before the visit is completed. 409 when a rating already exists.

### GET /api/ratings

- Purpose: list ratings.
- Permission: administrator or consultant.
- Request body: none.
- Response example: `{ "data": [{ "id": "uuid", "overall": 5, "hidden": false }] }`
- Errors: 403.

### PATCH /api/admin/ratings/:id

- Purpose: hide or show a rating.
- Permission: `administrator`.
- Request body: `{ "hidden": true }`
- Response example: `{ "data": { "id": "uuid", "hidden": true } }`
- Errors: 404.

### GET /api/admin/fees

- Purpose: read the hospital fee and policy row.
- Permission: `administrator`.
- Request body: none.
- Response example: `{ "data": { "id": "default", "consultationPerHourNaira": 30000, "registrationFeeNaira": 20000, "defaultDurationMinutes": 60 } }`
- Errors: 403.

### PATCH /api/admin/fees

- Purpose: update consultation and registration fees.
- Permission: `administrator`.
- Request body: `{ "consultationPerHourNaira": 30000, "registrationFeeNaira": 20000, "defaultDurationMinutes": 60 }`
- Response example: `{ "data": { "consultationPerHourNaira": 30000, "registrationFeeNaira": 20000, "defaultDurationMinutes": 60 } }`
- Errors: 400 when a fee is negative.

### PATCH /api/admin/policies

- Purpose: update cancellation, reschedule, and video join windows.
- Permission: `administrator`.
- Request body: `{ "cancellationNoticeHours": 24, "rescheduleNoticeHours": 24, "joinMinutesBefore": 15, "joinMinutesAfter": 30 }`
- Response example: `{ "data": { "cancellationNoticeHours": 24, "rescheduleNoticeHours": 24, "joinMinutesBefore": 15, "joinMinutesAfter": 30 } }`
- Errors: 400.

### POST /api/admin/staff

- Purpose: create or update a staff account. A new account's password is returned once.
- Permission: `administrator`.
- Request body: `{ "firstName": "Ngozi", "lastName": "Bello", "email": "ngozi@oouth.local", "role": "nurse", "departmentSlug": "nursing", "designation": "Nurse", "active": true }`
- Response example: `{ "data": { "id": "uuid", "staffId": "OOUTH-S-2026-0008", "password": "Staff#20268" } }`
- Errors: 409 when the email is already used.

### PATCH /api/admin/consultants/:slug

- Purpose: turn online booking on or off for a consultant.
- Permission: `administrator`.
- Request body: `{ "onlineBookingEnabled": false }`
- Response example: `{ "data": { "id": "uuid", "consultantSlug": "super_consultant", "onlineBookingEnabled": false } }`
- Errors: 404.

### POST /api/admin/staff/:id/session

- Purpose: open an audited session as that staff member. This replaces passwordless preview.
- Permission: `administrator`.
- Request body: none.
- Response example: `{ "data": { "role": "nurse", "userId": "uuid" } }`
- Errors: 404. The response also sets the access and refresh cookies for the target user.

### POST /api/admin/registration

- Purpose: mark a patient's annual registration as settled or due.
- Permission: `administrator`.
- Request body: `{ "userId": "uuid", "settled": true }`
- Response example: `{ "data": { "id": "uuid", "registrationPaidYear": 2026 } }`
- Errors: 404.

### POST /api/admin/departments

- Purpose: add an operational department for staff assignment. It is not offered for patient booking.
- Permission: `administrator`.
- Request body: `{ "name": "Medical Ward Office" }`
- Response example: `{ "data": { "slug": "medical-ward-office", "name": "Medical Ward Office", "patientBooking": false } }`
- Errors: 409 when the slug already exists.

### POST /api/admin/staff/department

- Purpose: assign a staff member to a department.
- Permission: `administrator`.
- Request body: `{ "userId": "uuid", "departmentSlug": "cardiology" }`
- Response example: `{ "data": { "id": "uuid", "departmentSlug": "cardiology" } }`
- Errors: 404.

### POST /api/admin/demo/reset

- Purpose: clear demonstration appointments, allergies, notices, and audit rows, and restore the seeded stock counts.
- Permission: `administrator`. Refused when `NODE_ENV` is `production`.
- Request body: none.
- Response example: `{ "data": { "ok": true } }`
- Errors: 403 in production.
