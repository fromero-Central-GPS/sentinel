import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function DashboardPage() {
  const { userId, sessionClaims } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  const stats = [
    {
      label: 'Fleet Status',
      value: 'Ready',
      detail: 'All systems operational',
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
    {
      label: 'Integrations',
      value: 'Pending',
      detail: 'GHL + Meta setup required',
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      label: 'Database',
      value: 'Connected',
      detail: 'Neon Serverless Postgres',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Auth Provider',
      value: 'Clerk',
      detail: sessionClaims?.org_id ? 'Organization' : 'Personal account',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
  ];

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Fleet intelligence and monitoring overview
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl border border-zinc-200 p-5 ${stat.bgColor} dark:border-zinc-800 dark:bg-opacity-10`}
          >
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              {stat.label}
            </p>
            <p className={`mt-2 text-2xl font-bold ${stat.color}`}>
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{stat.detail}</p>
          </div>
        ))}
      </div>

      {/* Quick Setup */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold">Quick Setup</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Configure your integrations to start monitoring your fleet.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Link
            href="/settings"
            className="flex items-center gap-4 rounded-lg border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-zinc-800 dark:hover:border-blue-800 dark:hover:bg-blue-950/50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/50">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Configure Integrations</p>
              <p className="text-xs text-zinc-500">
                Set up GHL and Meta / WhatsApp
              </p>
            </div>
            <svg className="ml-auto h-4 w-4 text-zinc-400" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>

          <div className="flex items-center gap-4 rounded-lg border border-zinc-200 p-4 opacity-60 dark:border-zinc-800">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div>
              <p className="font-medium">Fleet View</p>
              <p className="text-xs text-zinc-500">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold">System</h2>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex justify-between rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
            <span className="text-zinc-500">Framework</span>
            <span className="font-medium font-mono">Next.js 16</span>
          </div>
          <div className="flex justify-between rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
            <span className="text-zinc-500">Auth</span>
            <span className="font-medium font-mono">Clerk</span>
          </div>
          <div className="flex justify-between rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
            <span className="text-zinc-500">Database</span>
            <span className="font-medium font-mono">Neon</span>
          </div>
          <div className="flex justify-between rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-900">
            <span className="text-zinc-500">ORM</span>
            <span className="font-medium font-mono">Drizzle</span>
          </div>
        </div>
      </div>
    </div>
  );
}
