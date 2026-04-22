begin;

create table if not exists public.private_sync_state (
  user_id uuid primary key references public.users(id) on delete cascade,
  encrypted_payload jsonb not null,
  encryption_version integer not null default 1,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.private_sync_state enable row level security;
alter table public.private_sync_state force row level security;

revoke all on public.private_sync_state from anon, authenticated;

commit;
