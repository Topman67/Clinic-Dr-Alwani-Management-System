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

## Supabase database
For Supabase, do not use the direct `db.<project-ref>.supabase.co:5432` URL unless your network supports IPv6 or your Supabase project has the IPv4 add-on enabled. Prisma will fail before it can query data if that host cannot be reached.

Use the Supabase pooler connection string instead:

1. Open Supabase Dashboard.
2. Go to Project Settings -> Database -> Connection string.
3. Copy the Supavisor/Pooler URI.
4. For this backend, prefer the Session pooler URL on port `5432`.
5. Paste it into `backend/.env` as `DATABASE_URL`.

The format should look like this:

```env
DATABASE_URL="postgresql://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres?sslmode=require"
```

If you are deploying to a serverless/autoscaling host, use the Transaction pooler URL instead, usually port `6543`.

After changing the URL, run:

```powershell
npm run prisma:migrate
npm run prisma:generate
```

If this is a fresh Supabase database, migrations only create the tables. You still need to import old pgAdmin/PostgreSQL data or run the seed script to create login users.

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
