import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  env: {
    // Force local sign-in component — bypasses broken Clerk custom domain (accounts.supersonics.cl)
    // Vercel env var override is NOT enough; must be baked at build time
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  },
  turbopack: {
    root: path.resolve('.'),
  },
  serverExternalPackages: ['@neondatabase/serverless'],
  // Force Clerk to use embedded sign-in flow instead of Account Portal.
  // Vercel env var NEXT_PUBLIC_CLERK_SIGN_IN_URL currently points to
  // accounts.supersonics.cl which returns HTTP 403 (Clerk DNS not verified),
  // breaking both sign-in page rendering and Google OAuth.
  env: {
    NEXT_PUBLIC_CLERK_SIGN_IN_URL: '',
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: '',
    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: '/dashboard',
    NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: '/dashboard',
  },
};

export default nextConfig;
