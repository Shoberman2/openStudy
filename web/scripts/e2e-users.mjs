// Creates (or deletes) disposable Supabase users for the billing end-to-end tests (spec 11.5).
// Usage: node --env-file=.env.local scripts/e2e-users.mjs create   -> prints JSON {users:[{id,email,token}]}
//        node --env-file=.env.local scripts/e2e-users.mjs delete <id> [<id>...]
// Users get random example.com addresses and a random password; no email is ever sent.
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const [cmd, ...ids] = process.argv.slice(2);
if (cmd === "create") {
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `openstudy-e2e-${randomBytes(5).toString("hex")}@example.com`;
    const password = randomBytes(24).toString("base64url");
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const pub = createClient(url, anonKey, { auth: { persistSession: false } });
    const s = await pub.auth.signInWithPassword({ email, password });
    if (s.error) throw s.error;
    users.push({ id: data.user.id, email, token: s.data.session.access_token });
  }
  console.log(JSON.stringify({ users }));
} else if (cmd === "delete") {
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(id, error ? `error: ${error.message}` : "deleted");
  }
} else {
  console.error("usage: create | delete <id>...");
  process.exit(1);
}
