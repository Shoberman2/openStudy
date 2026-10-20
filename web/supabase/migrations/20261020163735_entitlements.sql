-- OpenStudy Plus entitlements (shared/SPEC.md 11.4). One row per account, written only by the
-- server (service role) from verified App Store and Stripe events. Users can read their own row.
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired', 'comp')),
  source text not null check (source in ('apple', 'stripe', 'comp')),
  product text,
  renews_at timestamptz,
  trial_ends_at timestamptz,
  original_transaction_id text unique,
  stripe_customer_id text unique,
  updated_at timestamptz not null default now()
);

alter table public.entitlements enable row level security;

drop policy if exists "read own entitlement" on public.entitlements;
create policy "read own entitlement" on public.entitlements for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- New tables are not exposed to the Data API automatically: grant explicitly.
revoke all on public.entitlements from anon, authenticated;
grant select on public.entitlements to authenticated;
grant select, insert, update, delete on public.entitlements to service_role;
