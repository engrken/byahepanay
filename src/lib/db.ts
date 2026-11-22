import { neon } from '@neondatabase/serverless';
export type NeonRows = Record<string, unknown>[];
export type NeonSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<NeonRows>) & {
  transaction: (queries: Promise<NeonRows>[], options?: { isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable'; readOnly?: boolean }) => Promise<NeonRows[]>;
};
let cachedSql: NeonSql | null = null;
/** Server-only Neon connection. Uses the Marketplace pooled URL for request-time queries. */
export function getDb(): NeonSql | null {
  const connectionString = process.env.BIYAHEPANAY_DATABASE_URL || process.env.BYAHEPANAY_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!cachedSql) cachedSql = neon(connectionString) as unknown as NeonSql;
  return cachedSql;
}
