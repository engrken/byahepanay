import { neon } from '@neondatabase/serverless';

// The Neon HTTP driver returns an array of row objects in its default mode.
// Keep that contract explicit so API handlers can safely index/count rows.
type NeonSql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

let cachedSql: NeonSql | null = null;

/**
 * Vercel Marketplace injects BYAHEPANAY_DATABASE_URL.
 * DATABASE_URL is supported for local development.
 * Server-only: never import this module from a Client Component.
 */
export function getDb(): NeonSql | null {
  const connectionString = process.env.BYAHEPANAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!cachedSql) cachedSql = neon(connectionString) as unknown as NeonSql;
  return cachedSql;
}
