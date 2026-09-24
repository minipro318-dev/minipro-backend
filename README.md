# Women Safety Backend (Step 1 + Step 2 MVP)

This backend currently implements two BRD milestones:
- Role-based authentication for `ADMIN`, `GUARDIAN`, and `END_USER`
- JWT-based API authentication
- PostgreSQL-backed server session storage
- SOS incident creation and status workflow
- Incident location logging and role-based incident visibility
- MVC project structure with Prisma ORM

## Tech Stack
- Node.js + Express
- PostgreSQL + Prisma
- JWT + bcrypt
- express-session + connect-pg-simple

## Project Structure
```text
config/
  db.js
controllers/
  auth.controller.js
  incident.controller.js
lib/
  prisma.js
middleware/
  auth.js
  error.js
prisma/
  schema.prisma
  migrations/
routes/
  auth.routes.js
  incident.routes.js
services/
  auth.service.js
  incident.service.js
utils/
  app-error.js
  async-handler.js
  validators.js
server.js
```

## Setup
1. Copy [.env.example](./.env.example) to `.env` and set your values.
2. Run migration:
   ```bash
   npm run prisma:migrate -- --name add_incident_module
   ```
3. Generate Prisma client:
   ```bash
   npm run prisma:generate
   ```
4. Start development server:
   ```bash
   npm run dev
   ```

## Auth API
Base path: `/api/auth`

### POST `/register`
Register user with role:
- `END_USER`
- `GUARDIAN`
- `ADMIN` (requires `adminRegistrationKey` matching `ADMIN_REGISTRATION_KEY`)

Payload:
```json
{
  "name": "Aanya Sharma",
  "email": "aanya@example.com",
  "mobile": "9876543210",
  "password": "StrongPass1",
  "confirmPassword": "StrongPass1",
  "role": "END_USER"
}
```

### POST `/login`
Payload:
```json
{
  "email": "aanya@example.com",
  "password": "StrongPass1"
}
```

### GET `/me`
Requires either:
- `Authorization: Bearer <token>`
- valid session cookie

### POST `/logout`
Ends the server session.

### POST `/guardian-links` (ADMIN only)
Links a guardian to an end user.

Payload:
```json
{
  "guardianId": 2,
  "endUserId": 3
}
```

## Incident API
Base path: `/api/incidents`

### POST `/sos` (END_USER)
Create a new SOS incident and initial location entry.

Payload:
```json
{
  "title": "Emergency SOS",
  "description": "Need immediate help",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "address": "MG Road, Bengaluru"
}
```

### GET `/`
List incidents based on role:
- `ADMIN`: all incidents
- `GUARDIAN`: incidents of linked end users
- `END_USER`: own incidents

### GET `/:id`
Get a single incident (with latest location history) if authorized.

### POST `/:id/locations`
Add live location update (incident owner or admin).

Payload:
```json
{
  "latitude": 12.9720,
  "longitude": 77.5950,
  "address": "Near Trinity Circle"
}
```

### PATCH `/:id/resolve`
- `ADMIN` can resolve active incidents.

### PATCH `/:id/cancel`
- `END_USER` (owner) can cancel own active incidents.
- `ADMIN` can cancel active incidents.
