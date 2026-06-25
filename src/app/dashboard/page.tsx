import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold">Sentinel Dashboard</h1>
      <p className="mt-4 text-muted-foreground">Welcome! You are signed in.</p>
    </div>
  );
}
