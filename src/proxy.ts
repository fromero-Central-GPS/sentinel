import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export default clerkMiddleware(async (auth, req) => {
  // auth() is available here via the clerkMiddleware wrapper
  const { userId } = await auth();

  // Public routes — allow through
  const pathname = req.nextUrl.pathname;
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/sign-up') ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/billing/plans');

  if (!isPublicRoute && !userId) {
    const signInUrl = new URL('/sign-in', req.url);
    // Preserve the intended destination so Clerk redirects back after sign-in
    signInUrl.searchParams.set('redirect_url', req.url);
    return NextResponse.redirect(signInUrl);
  }

  // For authenticated requests to protected routes, allow through
  // (Clerk middleware already enriched the request with auth)
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
