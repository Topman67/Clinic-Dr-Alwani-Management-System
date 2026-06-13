# Clinic-Dr-Alwani-Management-System

## Project Overview
Clinic Dr. Alwani Management System is a full-stack clinic management system developed to support daily operations in a small to medium-sized healthcare practice. The system centralizes patient registration, appointment scheduling, consultation recording, prescription handling, inventory tracking, payment processing, reporting, and audit monitoring in a single platform.

This project is designed as an academic software engineering project and demonstrates the integration of a modern web frontend with a structured backend and relational database. The goal is to improve operational efficiency, reduce manual record handling, and provide role-based access for different clinic staff.

## Main Users and Roles

### Doctor
- Review patient records and visit history
- Manage consultations and diagnoses
- Create prescriptions
- Monitor clinical workflow and selected reports

### Receptionist
- Register new patients and maintain patient profiles
- Schedule and manage appointments
- Start patient visits
- Handle payments and receipt generation

### Pharmacist
- Review prescriptions
- Verify and dispense medicines
- Monitor medicine stock and inventory availability

## Main Modules

### 1. Authentication and Role-Based Access Control
- Secure login for clinic staff
- Role-based route and feature access for doctor, receptionist, and pharmacist

### 2. Manage User Account
- Create and manage staff accounts
- Maintain user role assignments and account status

### 3. Manage Patient
- Register patients
- Update patient demographic and contact details
- Maintain patient records for future visits

### 4. Manage Appointment
- Create, update, and track appointments
- Support patient arrival and visit progression

### 5. Manage Consultation
- Record symptoms, diagnosis, notes, and consultation details
- Support follow-up consultations and medical checkup workflows

### 6. Manage Prescription
- Create prescriptions during consultation
- Track prescription verification and dispensing status

### 7. Manage Inventory
- Maintain medicine records, stock quantity, batch details, and expiry dates
- Track stock movement and inventory actions

### 8. Manage Payment
- Record clinic payments for services and medicines
- Support payment status tracking and receipt generation

### 9. Generate Report
- Produce operational and transaction reports
- Support monitoring of clinic activities and financial summaries

### 10. Audit Logs
- Record important system activities
- Improve accountability and traceability of user actions

## Tech Stack

### Frontend
- React
- Vite
- TypeScript
- Axios
- React Router

### Backend
- Node.js
- Express
- TypeScript
- Prisma

### Database
- PostgreSQL

### Authentication
- JWT
- bcrypt

## System Workflow Summary
1. Receptionist registers a patient or starts a visit.
2. Doctor performs and completes the consultation.
3. Doctor creates a prescription when medication is required.
4. Pharmacist verifies the prescription and dispenses the medicine.
5. Receptionist handles payment and issues the receipt.

## Installation Guide

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Clinic-Dr-Alwani-Management-System
```

### 2. Install Frontend Dependencies
```bash
cd frontend
npm install
```

### 3. Install Backend Dependencies
```bash
cd ../backend
npm install
```

### 4. Set Up Environment Variables
Copy the backend environment template and replace the placeholder values with your local configuration.

```bash
cd backend
cp .env.example .env
```

If you are using PowerShell on Windows, you can use:

```powershell
Copy-Item .env.example .env
```

For the frontend, create a `.env` file inside the `frontend` folder if you want to override the default API base URL.

### 5. Run Prisma Migration
```bash
cd backend
npm run prisma:migrate
npm run prisma:generate
```

### 6. Run the Backend Server
```bash
cd backend
npm run dev
```

The backend runs by default on:

```text
http://localhost:4000
```

### 7. Run the Frontend Application
Open a new terminal:

```bash
cd frontend
npm run dev
```

The frontend typically runs on:

```text
http://localhost:5173
```

## Environment Variables Example

### Backend `.env`
```env
DATABASE_URL="postgresql://username:password@localhost:5432/clinic_dr_alwani"
JWT_SECRET="replace_with_a_secure_random_secret"
JWT_EXPIRES_IN="1d"
PORT=4000
FRONTEND_URL="http://localhost:5173"
```

### Frontend `.env`
```env
VITE_API_BASE_URL="http://localhost:4000/api"
```

## Folder Structure
```text
Clinic-Dr-Alwani-Management-System/
|-- backend/
|   |-- prisma/
|   |   |-- migrations/
|   |   |-- schema.prisma
|   |   `-- seed.ts
|   |-- src/
|   |   |-- config/
|   |   |-- controllers/
|   |   |-- middleware/
|   |   |-- routes/
|   |   |-- services/
|   |   |-- types/
|   |   `-- utils/
|   |-- scripts/
|   `-- package.json
|-- frontend/
|   |-- public/
|   |-- src/
|   |   |-- assets/
|   |   |-- components/
|   |   |-- config/
|   |   |-- context/
|   |   |-- lib/
|   |   |-- pages/
|   |   |-- styles/
|   |   `-- test/
|   `-- package.json
`-- README.md
```

## Future Improvements
- Add email or SMS appointment reminders for patients
- Introduce dashboard analytics with richer data visualization
- Support electronic medical certificates and printable clinical documents
- Add barcode or QR-based inventory handling
- Improve reporting with export options such as PDF and Excel
- Add automated backup and recovery features
- Expand test coverage for frontend and backend modules
- Prepare deployment configuration for production hosting

## Conclusion
The Clinic Dr. Alwani Management System is intended to provide an organized and secure digital platform for clinic operations. By combining patient management, consultation handling, pharmacy workflow, payment recording, and reporting in one system, the project demonstrates a practical application of full-stack web development for healthcare administration.
