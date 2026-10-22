import pg from "pg";

// pg returns DATE columns as JS Dates in local time by default; keep them as
// plain YYYY-MM-DD strings so week maths never shifts by a timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error("DATABASE_URL is not set (see .env.example)");
    // Neon adds channel_binding=require, which node-postgres doesn't read; TLS still applies.
    const connectionString = raw.replace(/([?&])channel_binding=[^&]*&?/, "$1").replace(/[?&]$/, "");
    // Hosted Postgres (Neon, Supabase) needs TLS; a local database usually has none.
    // Supabase signs with its own CA, so the certificate chain isn't verified.
    const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString);
    const ssl = local || process.env.DATABASE_SSL === "off" ? undefined : { rejectUnauthorized: false };
    pool = new pg.Pool({ connectionString, ssl, max: 3 });
  }
  return pool;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
