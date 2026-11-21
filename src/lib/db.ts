import { neon } from '@neondatabase/serverless';

type NeonSql = ReturnType<typeof neon>;
let cachedSql: NeonSql | null = null;

/**
 * Vercel Marketplace injects BYAHEPANAY_DATABASE_URL.
 * DATABASE_URL is supported for local development.
 * Server-only: never import this module from a Client Component.
 */
export function getDb(): NeonSql | null {
  const connectionString = process.env.BYAHEPANAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!cachedSql) cachedSql = neon(connectionString);
  return cachedSql;
}
