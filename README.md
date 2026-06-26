# Sentinel

Versión SaaS multitenant de Cassper Dashboard. Cada organización (tenant) conecta sus credenciales de GHL y Meta para acceder a los motores de análisis de conversaciones: Forense, Live Opp y Won Track.

## Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Auth | Clerk (organizations) |
| Database | Neon (Serverless Postgres) |
| ORM | Drizzle ORM |
| Styling | Tailwind CSS 4 |
| Linting | ESLint 9 + Prettier |

## Getting Started

### Prerequisites

- Node.js 20+
- [Clerk account](https://dashboard.clerk.com) — for auth keys
- [Neon account](https://console.neon.tech) — for database

### Setup

```bash
# 1. Clone and install
git clone <repo-url> sentinel
cd sentinel
npm ci

# 2. Copy env template
cp .env.example .env.local

# 3. Set required environment variables in .env.local:
#    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — from Clerk dashboard
#    CLERK_SECRET_KEY — from Clerk dashboard
#    DATABASE_URL — from Neon console (connection string)

# 4. Push database schema
npm run db:push

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `npm run format:check` | Check formatting |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:push` | Push schema to Neon |
| `npm run db:migrate` | Run Drizzle migrations |
| `npm run db:studio` | Open Drizzle Studio |

## Deployment

### Environments

| Branch | Environment | URL |
|--------|-------------|-----|
| `dev` | Preview | `sentinel-dev.vercel.app` |
| `staging` | Preview | `sentinel-staging.vercel.app` |
| `main` | Production | `sentinel.vercel.app` |

### Vercel Setup

```bash
# 1. Link project
vercel link

# 2. Pull/configure env vars per environment
vercel env pull .env.vercel.local
vercel env add DATABASE_URL production
vercel env add DATABASE_URL preview

# 3. Deploy
vercel deploy --prod  # production
vercel deploy          # preview
```

### Neon Branches

Each environment gets its own Neon branch:

```bash
# Create dev/staging/prod branches from main
bash scripts/setup-neon-branches.sh main

# Update each environment's DATABASE_URL with the branch connection string
```

### Git Workflow

1. Feature branches → `dev` (auto preview deploy)
2. `dev` → `staging` (QA preview deploy)
3. `staging` → `main` (production deploy)

## Project Structure

```
src/
├── app/                  # Next.js App Router
│   ├── layout.tsx        # Root layout (ClerkProvider, fonts)
│   ├── page.tsx          # Landing page
│   ├── sign-in/          # Clerk sign-in
│   ├── sign-up/          # Clerk sign-up
│   └── dashboard/        # Protected dashboard
├── db/
│   ├── schema.ts         # Drizzle schema (users, orgs)
│   └── index.ts          # Database client
└── middleware.ts          # Clerk middleware → proxy
```
