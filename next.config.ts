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
};

export default nextConfig;
