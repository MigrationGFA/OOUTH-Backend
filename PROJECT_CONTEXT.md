# Project context

OOUTH Backend is the hospital API for the OOUTH corporate services frontend. The patient is the identity every clinical and administrative record points at. The frontend keeps `useAppState()` as a cache filled by `GET /api/session/workspace`. It no longer stores the hospital database in `localStorage`.

Consultation drafts still live in the browser IndexedDB database. Three seconds after typing stops, changed fields are sent with `PATCH /api/appointments/:id/encounter`. Signing is a separate action.

Payments for online visits go through Paystack on the server. Desk payments are a fictional desk ledger and do not call Paystack. A verified Paystack reference confirms a visit once.

The demonstration staff are real seeded accounts. Preview buttons sign in with those accounts. Passwordless preview sessions have been removed.
