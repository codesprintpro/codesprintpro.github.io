create table if not exists public.newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'blog',
  created_at timestamptz not null default now()
);

alter table public.newsletter_subscribers enable row level security;

drop policy if exists "Allow public newsletter signup inserts"
  on public.newsletter_subscribers;

create policy "Allow public newsletter signup inserts"
  on public.newsletter_subscribers
  for insert
  to anon
  with check (
    email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
    and length(email) <= 320
    and length(source) <= 120
  );
