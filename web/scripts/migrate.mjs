// Applies web/supabase/migrations/*.sql to the Supabase database in order (spec 11.4).
// Each file runs once; applied names are recorded in public.openstudy_migrations.
// Usage: node --env-file=.env.local scripts/migrate.mjs
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("POSTGRES_URL_NON_POOLING is not set. Run `vercel env pull` first.");
  process.exit(1);
}
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
// Supabase poolers present a certificate the Node default store does not chain; the URL's sslmode is ignored here.
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("create table if not exists public.openstudy_migrations (name text primary key, applied_at timestamptz not null default now())");
  await client.query("alter table public.openstudy_migrations enable row level security");
  await client.query("revoke all on public.openstudy_migrations from anon, authenticated");
  const done = new Set((await client.query("select name from public.openstudy_migrations")).rows.map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    await client.query("begin");
    try {
      await client.query(readFileSync(resolve(dir, name), "utf8"));
      await client.query("insert into public.openstudy_migrations (name) values ($1)", [name]);
      await client.query("commit");
      console.log("applied", name);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
