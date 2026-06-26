import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

const ENGINES = [
  {
    href: '/dashboard/forense',
    title: 'Forense',
    description: 'Clasifica conversaciones perdidas por fase y causa raíz. Prioriza cuáles vale la pena recuperar.',
    status: 'active' as const,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50/50',
  },
  {
    href: '/dashboard/live-opp',
    title: 'Live Opp',
    description: 'Detecta oportunidades abiertas en riesgo antes de que se pierdan. Alertas tempranas por inactividad.',
    status: 'soon' as const,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-zinc-200 hover:border-blue-300 hover:bg-blue-50/50',
  },
  {
    href: '/dashboard/won-track',
    title: 'Won Track',
    description: 'Monitorea patrones de deals ganados. Identifica señales y tiempos de cierre que replican el éxito.',
    status: 'soon' as const,
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    ),
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-zinc-200 hover:border-green-300 hover:bg-green-50/50',
  },
];

export default async function DashboardPage() {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const orgId = (sessionClaims as any)?.org_id;

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Motores de análisis de conversaciones GHL para tu equipo comercial
        </p>
      </div>

      {/* Motores */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">Motores</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {ENGINES.map((engine) => (
            <Link
              key={engine.href}
              href={engine.href}
              className={`flex flex-col gap-4 rounded-xl border p-5 transition-colors ${engine.border} dark:border-zinc-800`}
            >
              <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${engine.bg} ${engine.color}`}>
                  {engine.icon}
                </div>
                {engine.status === 'active' ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Disponible
                  </span>
                ) : (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                    Próximamente
                  </span>
                )}
              </div>
              <div>
                <p className="font-semibold text-zinc-900">{engine.title}</p>
                <p className="mt-1 text-sm text-zinc-500">{engine.description}</p>
              </div>
              <div className={`text-xs font-medium ${engine.color} flex items-center gap-1`}>
                {engine.status === 'active' ? 'Ver análisis →' : 'En construcción'}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick setup */}
      {!orgId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-800">Configuración pendiente</h2>
          <p className="mt-1 text-sm text-amber-700">
            Crea una organización y configura las credenciales GHL para activar los motores con datos reales.
          </p>
          <div className="mt-3 flex gap-3">
            <Link
              href="/settings"
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
            >
              Ir a Settings
            </Link>
          </div>
        </div>
      )}

      {/* System info */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">Sistema</h2>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Framework', value: 'Next.js 16' },
            { label: 'Auth', value: 'Clerk' },
            { label: 'Database', value: 'Neon' },
            { label: 'ORM', value: 'Drizzle' },
          ].map(({ label, value }) => (
            <div key={label} className="flex justify-between rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
              <span className="text-zinc-500">{label}</span>
              <span className="font-medium font-mono text-zinc-800">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
