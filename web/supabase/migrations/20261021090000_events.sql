-- Usage data (spec 12.3): categories and counts from each install, written only by the server.
create table if not exists public.events (
  id bigserial primary key,
  t timestamptz not null,
  received_at timestamptz not null default now(),
  install_id uuid not null,
  user_id uuid references auth.users on delete set null,
  platform text not null,
  app_version text,
  name text not null,
  props jsonb not null default '{}'::jsonb
);
create index if not exists events_t on public.events (t);
create index if not exists events_name_t on public.events (name, t);
create index if not exists events_install on public.events (install_id);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;
