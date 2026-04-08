create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists "Allow public contact message inserts"
  on public.contact_messages;

create policy "Allow public contact message inserts"
  on public.contact_messages
  for insert
  to anon
  with check (
    length(name) between 1 and 120
    and email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    and length(email) <= 320
    and length(message) between 1 and 5000
  );
