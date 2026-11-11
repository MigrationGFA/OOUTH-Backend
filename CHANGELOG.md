# Changelog

## 0.1.0

- Added the Express, TypeScript, Prisma, and PostgreSQL API for the OOUTH frontend contract.
- Added authentication with Argon2id, a short access JWT, and rotating refresh cookies.
- Added booking, Paystack verification, consultation signing, desk, nursing, pharmacy, diagnostics, and ratings.
- Added the workspace snapshot, presence flags, and the administrator routes the screens call.
- Left Redis, SMS, Azure Blob, and a log platform unwired behind interfaces.
- Connected the frontend cache to the API, with IndexedDB draft recovery and a Paystack redirect.
- Documented every route in `docs/API.md`.
