-- FirstPR initial schema.
--
-- Design notes:
--  * Every row is owned by exactly one auth user; RLS is deny-by-default and
--    ownership is enforced on every table, including child tables.
--  * The raw GitHub snapshot is kept as jsonb so evidence can be recomputed
--    when the engine's rules change, without re-hitting the GitHub API.
--  * Derived evidence is normalised so it can be queried, sorted and indexed.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: app-level user record, 1:1 with auth.users
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  github_login text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per authenticated app user.';

-- ---------------------------------------------------------------------------
-- evidence_snapshots: one GitHub import
-- ---------------------------------------------------------------------------
create table public.evidence_snapshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  github_login text not null,
  collected_at timestamptz not null,
  generated_at timestamptz not null,
  raw_snapshot jsonb not null,
  notes        text[] not null default '{}',
  created_at   timestamptz not null default now(),

  constraint evidence_snapshots_login_not_blank check (length(trim(github_login)) > 0)
);

create index evidence_snapshots_user_recent_idx
  on public.evidence_snapshots (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- skill_evidence: derived, explainable scores for one snapshot
-- ---------------------------------------------------------------------------
create table public.skill_evidence (
  id               uuid primary key default gen_random_uuid(),
  snapshot_id      uuid not null references public.evidence_snapshots (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  skill_id         text not null,
  label            text not null,
  category         text not null,
  confidence       text not null,
  score            integer not null,
  breadth          numeric(4, 2) not null,
  freshness        numeric(4, 2) not null,
  depth            numeric(4, 2) not null,
  repo_count       integer not null,
  last_observed_at timestamptz not null,
  rationale        text not null,

  constraint skill_evidence_unique_per_snapshot unique (snapshot_id, skill_id),
  constraint skill_evidence_category_valid
    check (category in ('language', 'framework', 'practice', 'infrastructure')),
  constraint skill_evidence_confidence_valid
    check (confidence in ('strong', 'moderate', 'weak')),
  constraint skill_evidence_score_range check (score between 0 and 100),
  constraint skill_evidence_repo_count_positive check (repo_count >= 0)
);

create index skill_evidence_snapshot_score_idx
  on public.skill_evidence (snapshot_id, score desc);

-- ---------------------------------------------------------------------------
-- evidence_citations: the proof behind each skill. A skill with no citation is
-- a claim, not evidence, so the app never writes one.
-- ---------------------------------------------------------------------------
create table public.evidence_citations (
  id                uuid primary key default gen_random_uuid(),
  skill_evidence_id uuid not null references public.skill_evidence (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  kind              text not null,
  repo              text not null,
  detail            text not null,
  url               text not null,

  constraint evidence_citations_kind_valid
    check (kind in ('language-bytes', 'file', 'dependency', 'topic', 'merged-pr'))
);

create index evidence_citations_skill_idx
  on public.evidence_citations (skill_evidence_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default, owner-only access on every table.
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.evidence_snapshots enable row level security;
alter table public.skill_evidence     enable row level security;
alter table public.evidence_citations enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles
  for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy evidence_snapshots_select_own on public.evidence_snapshots
  for select using (auth.uid() = user_id);
create policy evidence_snapshots_insert_own on public.evidence_snapshots
  for insert with check (auth.uid() = user_id);
create policy evidence_snapshots_delete_own on public.evidence_snapshots
  for delete using (auth.uid() = user_id);

create policy skill_evidence_select_own on public.skill_evidence
  for select using (auth.uid() = user_id);
create policy skill_evidence_insert_own on public.skill_evidence
  for insert with check (auth.uid() = user_id);
create policy skill_evidence_delete_own on public.skill_evidence
  for delete using (auth.uid() = user_id);

create policy evidence_citations_select_own on public.evidence_citations
  for select using (auth.uid() = user_id);
create policy evidence_citations_insert_own on public.evidence_citations
  for insert with check (auth.uid() = user_id);
create policy evidence_citations_delete_own on public.evidence_citations
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Keep profiles in step with auth.users.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, github_login, display_name, avatar_url)
  values (
    new.id,
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
