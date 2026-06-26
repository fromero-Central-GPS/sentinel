import { Show } from '@clerk/nextjs';
import { SignInButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 dark:bg-black p-8">
      <header className="absolute top-0 right-0 p-4">
        <Show when="signed-in">
          <UserButton />
        </Show>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background hover:opacity-90">
              Sign In
            </button>
          </SignInButton>
        </Show>
      </header>

      <main className="flex flex-col items-center gap-8 text-center max-w-2xl">
        <h1 className="text-5xl font-bold tracking-tight">Sentinel</h1>
        <p className="text-xl text-zinc-600 dark:text-zinc-400 max-w-md">
          Cassper para tu empresa. Analiza conversaciones perdidas, monitorea oportunidades en
          riesgo y recupera revenue — para múltiples equipos comerciales.
        </p>
        <div className="flex gap-4">
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90"
            >
              Go to Dashboard
            </Link>
          </Show>
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background hover:opacity-90">
                Get Started
              </button>
            </SignInButton>
          </Show>
        </div>
      </main>
    </div>
  );
}
