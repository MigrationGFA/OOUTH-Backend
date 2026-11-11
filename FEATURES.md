# Features

- Patient registration, login, logout, refresh, password change, and password reset
- Role checks for patient, consultant, administrator, desk officer, nurse, pharmacist, and laboratory officer
- Departments, consultants, availability, and weekday slots in Africa/Lagos
- Online booking onto the super consultant, with one active booking per slot
- Paystack initialize, verify, and signed webhook, each reference applied once
- Desk registration, walk-in visits, fictional desk payments, check-in, queue status, and request collection
- Encounter drafts with revision checks and idempotency keys, plus an explicit sign action
- Signed consultations fan out to journeys, pharmacy lines, and investigation orders
- Pharmacy dispense with stock checks, diagnostics, nursing administrations, observations, handovers, beds, and admissions
- Ratings, fees, policies, staff, consultant booking, and an administrator session switch that is audited
- Role-filtered workspace snapshot for the frontend cache
- Short-lived HMAC video token with no third-party room and no recording
- Audit rows for mutations
- Swagger at `/api/docs`
