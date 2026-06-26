import { auth, clerkClient } from '@clerk/nextjs/server';
import { eq, and } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users, organizations, userOrganizations, subscriptions, plans } from '@/db/schema';

export async function POST() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized — no user or org in session' }, { status: 401 });
  }

  try {
    const client = await clerkClient();
    const [clerkUser, clerkOrg] = await Promise.all([
      client.users.getUser(userId),
      client.organizations.getOrganization({ organizationId: orgId }),
    ]);

    const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email;

    // 1. Upsert user
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);

    let userDbId: string;
    if (existingUser) {
      userDbId = existingUser.id;
      await db
        .update(users)
        .set({ email, name, avatarUrl: clerkUser.imageUrl || existingUser.avatarUrl })
        .where(eq(users.clerkId, userId));
    } else {
      const [newUser] = await db
        .insert(users)
        .values({ clerkId: userId, email, name, avatarUrl: clerkUser.imageUrl || null })
        .returning({ id: users.id });
      userDbId = newUser.id;
    }

    // 2. Upsert org
    const [existingOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.clerkOrgId, orgId))
      .limit(1);

    let orgDbId: string;
    if (existingOrg) {
      orgDbId = existingOrg.id;
      await db
        .update(organizations)
        .set({ name: clerkOrg.name, slug: clerkOrg.slug })
        .where(eq(organizations.clerkOrgId, orgId));
    } else {
      const [newOrg] = await db
        .insert(organizations)
        .values({ clerkOrgId: orgId, name: clerkOrg.name, slug: clerkOrg.slug })
        .returning({ id: organizations.id });
      orgDbId = newOrg.id;
    }

    // 3. Upsert membership
    const [existingMembership] = await db
      .select()
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userDbId),
          eq(userOrganizations.organizationId, orgDbId)
        )
      )
      .limit(1);

    if (!existingMembership) {
      await db.insert(userOrganizations).values({
        userId: userDbId,
        organizationId: orgDbId,
        role: 'admin',
      });
    }

    // 4. Create Free subscription if none exists
    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgDbId))
      .limit(1);

    if (!existingSub) {
      const [freePlan] = await db
        .select()
        .from(plans)
        .where(eq(plans.slug, 'free'))
        .limit(1);

      if (freePlan) {
        await db.insert(subscriptions).values({
          organizationId: orgDbId,
          planId: freePlan.id,
          status: 'active',
        });
      }
    }

    return NextResponse.json({ ok: true, orgDbId });
  } catch (err: any) {
    console.error('Org sync error:', err);
    return NextResponse.json({ error: `Sync failed: ${err.message}` }, { status: 500 });
  }
}
