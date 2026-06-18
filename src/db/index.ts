import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Supabase transaction pooler requires prepare:false (no prepared statements).
const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle({ client, schema });
