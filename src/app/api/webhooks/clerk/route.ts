import { NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@/db/schema';
import { eq, and } from 'drizzle-orm';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle({ client: neon(url) });
}

export async function POST(request: NextRequest) {
  const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json(
      { error: 'CLERK_WEBHOOK_SIGNING_SECRET not configured' },
      { status: 500 }
    );
  }

  const wh = new Webhook(signingSecret);
  const body = await request.text();

  let event: any;
  try {
    event = wh.verify(body, {
      'webhook-id': request.headers.get('webhook-id') || '',
      'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
      'webhook-signature': request.headers.get('webhook-signature') || '',
    } as any);
  } catch {
    try {
      event = wh.verify(body, {
        'webhook-id': request.headers.get('svix-id') || '',
        'webhook-timestamp': request.headers.get('svix-timestamp') || '',
        'webhook-signature': request.headers.get('svix-signature') || '',
      } as any);
    } catch {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }
  }

  const db = getDb();
  const { type, data } = event;

  try {
    switch (type) {
      case 'user.created': {
        await db.insert(schema.users).values({
          clerkId: data.id,
          email: data.email_addresses?.[0]?.email_address || '',
          name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || null,
          avatarUrl: data.image_url || null,
        });
        break;
      }

      case 'user.updated': {
        const existing = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.clerkId, data.id))
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(schema.users)
            .set({
              email: data.email_addresses?.[0]?.email_address || existing[0].email,
              name: `${data.first_name || ''} ${data.last_name || ''}`.trim() || existing[0].name,
              avatarUrl: data.image_url || existing[0].avatarUrl,
            })
            .where(eq(schema.users.clerkId, data.id));
        }
        break;
      }

      case 'user.deleted': {
        const existing = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.clerkId, data.id))
          .limit(1);

        if (existing.length > 0) {
          await db.delete(schema.users).where(eq(schema.users.clerkId, data.id));
        }
        break;
      }

      case 'organization.created': {
        await db.insert(schema.organizations).values({
          clerkOrgId: data.id,
          name: data.name,
          slug: data.slug,
        });

        // Assign Free plan automatically for new orgs
        const newOrg = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.clerkOrgId, data.id))
          .limit(1);

        if (newOrg.length > 0) {
          const freePlan = await db
            .select()
            .from(schema.plans)
            .where(eq(schema.plans.slug, 'free'))
            .limit(1);

          if (freePlan.length > 0) {
            await db.insert(schema.subscriptions).values({
              organizationId: newOrg[0].id,
              planId: freePlan[0].id,
              status: 'active',
            });
          }
        }
        break;
      }

      case 'organization.updated': {
        const existingOrg = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.clerkOrgId, data.id))
          .limit(1);

        if (existingOrg.length > 0) {
          await db
            .update(schema.organizations)
            .set({ name: data.name, slug: data.slug })
            .where(eq(schema.organizations.clerkOrgId, data.id));
        }
        break;
      }

      case 'organization.deleted': {
        const existingOrg = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.clerkOrgId, data.id))
          .limit(1);

        if (existingOrg.length > 0) {
          await db
            .delete(schema.organizations)
            .where(eq(schema.organizations.clerkOrgId, data.id));
        }
        break;
      }

      case 'organizationMembership.created': {
        const userRecord = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.clerkId, data.public_user_data?.user_id || ''))
          .limit(1);

        const orgRecord = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.clerkOrgId, data.organization?.id || ''))
          .limit(1);

        if (userRecord.length > 0 && orgRecord.length > 0) {
          // Check if membership already exists
          const existing = await db
            .select()
            .from(schema.userOrganizations)
            .where(
              and(
                eq(schema.userOrganizations.userId, userRecord[0].id),
                eq(schema.userOrganizations.organizationId, orgRecord[0].id)
              )
            )
            .limit(1);

          if (existing.length === 0) {
            await db.insert(schema.userOrganizations).values({
              userId: userRecord[0].id,
              organizationId: orgRecord[0].id,
              role: data.role || 'member',
            });
          }
        }
        break;
      }

      case 'organizationMembership.deleted': {
        const userRecord = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.clerkId, data.public_user_data?.user_id || ''))
          .limit(1);

        const orgRecord = await db
          .select()
          .from(schema.organizations)
          .where(eq(schema.organizations.clerkOrgId, data.organization?.id || ''))
          .limit(1);

        if (userRecord.length > 0 && orgRecord.length > 0) {
          await db
            .delete(schema.userOrganizations)
            .where(
              and(
                eq(schema.userOrganizations.userId, userRecord[0].id),
                eq(schema.userOrganizations.organizationId, orgRecord[0].id)
              )
            );
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${type}`);
    }
  } catch (err: any) {
    console.error(`Webhook handler error (${type}):`, err);
    return NextResponse.json({ error: `Handler error: ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
