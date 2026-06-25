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
    url: process.env.DATABASE_URL!,
  },
});
