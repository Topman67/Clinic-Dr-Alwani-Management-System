# Clinic Dr. Alwani CMS — Backend

Node.js + Express + Prisma (PostgreSQL) API for authentication, RBAC, patients, prescriptions, inventory, payments/receipts, reports, and audit logs.

## Prerequisites
- Node 18+
- PostgreSQL

## Setup
1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, `PORT` (optional).
2. Install deps:
```powershell
cd "d:\Clinic DR Alwani\backend"
npm install
```
3. Run migrations and generate client (creates DB schema):
```powershell
npx prisma migrate dev --name init
npx prisma generate
```
4. Seed sample data (doctor/receptionist/pharmacist, patient, medicine, payment+receipt):
```powershell
npx ts-node prisma/seed.ts
```
5. Start dev server:
```powershell
npm run dev
```

## API Base
`/api`

Key routes (RBAC enforced via middleware):
- Auth: `POST /api/auth/login`
- Users (Doctor): `GET|POST /api/users`, `PUT /api/users/:id`, `PUT /api/users/:id/password`, `DELETE /api/users/:id`
- Patients (Doctor/Receptionist/Pharmacist): `GET|POST /api/patients`, `GET /api/patients/:id`, `PUT /api/patients/:id`
- Prescriptions (Doctor/Pharmacist): `GET|POST /api/prescriptions`, `GET /api/prescriptions/:id`
- Medicine (Doctor/Pharmacist): `GET|POST /api/medicine`, `PUT /api/medicine/:id`, `DELETE /api/medicine/:id`
- Payments (Doctor/Receptionist): `GET|POST /api/payments` (receipt auto-created)
- Reports (Doctor/Receptionist/Pharmacist): payments, receipts, inventory low/expiring
- Audit logs (Doctor): `GET /api/audit-logs`

## Notes
- Password hashing uses bcrypt.
- JWT auth with role stored in token; RBAC middleware protects routes.
- Receipts auto-generate numbers with `RCP-YYYYMMDD-XXXX` pattern.
- Audit logs capture key actions (login, create/update entities, payments).
