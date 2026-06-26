import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Force Clerk to use embedded <SignIn/> component instead of Account Portal.
  // Vercel env var NEXT_PUBLIC_CLERK_SIGN_IN_URL currently points to
  // accounts.supersonics.cl which returns HTTP 403 (Clerk DNS not verified),
  // breaking both sign-in page rendering and Google OAuth.
  // Empty string = use Clerk's default embedded component behavior.
  env: {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '',
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: '/dashboard',
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: '/dashboard',
  },
  turbopack: {
    root: path.resolve('.'),
  },
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
