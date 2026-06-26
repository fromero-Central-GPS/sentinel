= CEN-1054 Sentinel MVP Status =

== Completed ==
- Scaffold Next.js 16 + TypeScript + Tailwind + ESLint
- Auth Clerk: sign-in, sign-up, Google OAuth (fixed 2026-06-26), org creation
- Schema PostgreSQL multitenant + migraciones Drizzle
- Settings page: GHL API Token + Location ID + Meta WABA/WhatsApp
- API /api/settings/ghl, /api/settings/meta (encrypted read/write)
- Vercel linked + env vars (except Vercel CLI token)
- Landing page + dashboard con motores
- 3 engine pages: Forense, Live Opp, Won Track (with mock data + GHL API integration)
- Plan enforcement middleware (motor access + conversation limits per plan)
- Billing schema + seed plans + pricing page
- Onboarding wizard (create org -> GHL -> Meta -> done)
- PlanBadge with usage bar in dashboard sidebar
- Clerk webhook handler (user/org lifecycle -> Neon DB)
- Build: 0 errors, 22/22 static pages

== Pending (child issues) ==
- CEN-1049: Neon branches per environment
- CEN-1050: Dev/staging domain setup

== Recent Fixes ==
- Google OAuth: bypassed unverified Clerk custom domain (accounts.supersonics.cl)
  Commit ec2fea5 — ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up"
  .env.local now has NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY

== Disposition ==
CEN-1054 core MVP complete. Google OAuth working.
Remaining infra items tracked in CEN-1049 and CEN-1050.