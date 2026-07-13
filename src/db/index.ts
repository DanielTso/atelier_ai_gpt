import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — configure it in .env.local (see CLAUDE.md).');
}

// Supabase transaction pooler requires prepare:false (no prepared statements).
// Bounded client-side pool: Fluid Compute reuses instances, so idle connections
// linger without idle_timeout; max_lifetime rotates connections under the
// pooler's own recycling horizon. Units are seconds (postgres-js).
const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 10,               // postgres-js default, made explicit
  idle_timeout: 20,      // close idle connections after 20s
  connect_timeout: 10,   // fail a hung dial in 10s instead of 30s
  max_lifetime: 60 * 30, // rotate connections after 30min
});

export const db = drizzle({ client, schema });
