# DevConnect — Full-stack developer community MVP

A working local full-stack starter for a developer networking platform.

## Features
- Email/password registration and login (bcrypt password hashing + JWT)
- Developer profile editing and searchable directory
- Project CRUD (create, list, delete own projects)
- Technical blog publishing and deletion
- Connection requests (send, accept, reject, remove)
- Skill endorsements
- Notifications and dashboard summary

## Stack
- Frontend: React, TypeScript, Vite, Lucide icons, custom responsive CSS
- Backend: Node.js, Express, TypeScript, Zod
- Database: SQLite via Prisma (chosen to avoid a separate database installation for a quick local demo)

## Requirements
- Node.js 20 LTS or newer
- npm

## Windows setup
Open PowerShell in this folder and run:

```powershell
npm install
npm install --prefix server
npm install --prefix client
Copy-Item server/.env.example server/.env
npm run db:push --prefix server
npm run dev
```

Open **http://localhost:5173**. The API runs at **http://localhost:5000**.

If `Copy-Item` says the file exists, keep your existing `.env`. Change `JWT_SECRET` in `server/.env` before any public deployment. The local SQLite database is created automatically by Prisma in `server/prisma/dev.db`.

## Demo flow
1. Register a new account.
2. Open My Profile and add a headline, bio, location and comma-separated skills.
3. Add a project and publish a blog post.
4. Register a second account in another browser/private window.
5. Use Discover to find the first account and send a connection request.
6. Accept the request from the first account's Connections page.
7. Open Notifications to see activity updates.

## API routes
- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/dashboard`
- `PUT /api/profile`, `GET /api/users`, `GET /api/users/:id`
- `GET/POST /api/projects`, `DELETE /api/projects/:id`
- `GET/POST /api/posts`, `DELETE /api/posts/:id`
- `GET /api/connections`, `POST /api/connections/:userId`, `PATCH /api/connections/:id`
- `POST /api/users/:id/endorse`
- `GET /api/notifications`, `PATCH /api/notifications/read`

All routes except health and register/login require `Authorization: Bearer <token>`.

## Important scope notes
This is a functional local MVP, not a production-hardened deployment. GitHub OAuth, Cloudinary uploads, Socket.io live push, email verification/password reset, automated tests, rate limiting, and hosted deployment are not configured in this version. For production, use PostgreSQL, HTTPS, secure HttpOnly cookies, stronger validation/rate limits, and a managed secrets store. The current JWT is stored in browser localStorage for demo simplicity.
