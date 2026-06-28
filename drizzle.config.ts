import { defineConfig } from 'drizzle-kit';
import { loadEnvConfig } from '@next/env';

// Load .env.local so drizzle-kit can read DATABASE_URL
const projectDir = process.cwd();
loadEnvConfig(projectDir);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    // Prefer DATABASE_DIRECT_URL (standard pg protocol) for migrations.
    // Neon's pooled/serverless URL uses WebSockets and doesn't work with drizzle-kit.
    url: (process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL)!,
  },
});
