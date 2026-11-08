-- Issue discovery: search runs, the repo health behind them, and the ranking.
--
-- Discovery is expensive in GitHub rate limit, so a run is persisted and
-- re-read rather than recomputed on every page view.
--
-- Signals and reasons are stored as jsonb: they are display-only explanation
-- payloads that are never filtered or joined on. Everything the app actually
-- queries or orders by is a real column.

create table public.discovery_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  snapshot_id    uuid references public.evidence_snapshots (id) on delete set null,
  languages      text[] not null default '{}',
  notes          text[] not null default '{}',
  requests_used  integer not null default 0,
  -- The excluded issues themselves are not worth storing, but their count is:
  -- without it the UI would report "0 filtered out" when it filtered dozens.
  excluded_count integer not null default 0,
  created_at     timestamptz not null default now(),

  constraint discovery_runs_requests_sane check (requests_used >= 0),
  constraint discovery_runs_excluded_sane check (excluded_count >= 0)
);

create index discovery_runs_user_recent_idx
  on public.discovery_runs (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- repo_health: one scored repository within a run.
-- survival_score is nullable on purpose — a repo we could not read enough of
-- has no score, and that is different from a score of zero.
-- ---------------------------------------------------------------------------
create table public.repo_health (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.discovery_runs (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  full_name      text not null,
  html_url       text not null,
  survival_score integer,
  band           text not null,
  coverage       numeric(4, 2) not null,
  archived       boolean not null default false,
  summary        text not null,
  signals        jsonb not null default '[]'::jsonb,

  constraint repo_health_unique_per_run unique (run_id, full_name),
  constraint repo_health_band_valid
    check (band in ('healthy', 'mixed', 'risky', 'insufficient-data')),
  constraint repo_health_score_range
    check (survival_score is null or survival_score between 0 and 100),
  constraint repo_health_coverage_range check (coverage between 0 and 1),
  -- An unscored repo must be banded as such, and a scored one must not be.
  constraint repo_health_band_matches_score
    check ((survival_score is null) = (band = 'insufficient-data') or archived)
);

create index repo_health_run_idx on public.repo_health (run_id);

-- ---------------------------------------------------------------------------
-- ranked_issues: the ordered recommendations, with their explanations.
-- ---------------------------------------------------------------------------
create table public.ranked_issues (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.discovery_runs (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  github_issue_id   bigint not null,
  issue_number      integer not null,
  title             text not null,
  url               text not null,
  repo_full_name    text not null,
  labels            text[] not null default '{}',
  score             integer not null,
  rank              integer not null,
  matched_skills    text[] not null default '{}',
  reasons           jsonb not null default '[]'::jsonb,
  comment_count     integer not null default 0,
  body_length       integer not null default 0,
  issue_created_at  timestamptz not null,
  issue_updated_at  timestamptz not null,

  constraint ranked_issues_unique_per_run unique (run_id, github_issue_id),
  constraint ranked_issues_score_range check (score between 0 and 100),
  constraint ranked_issues_rank_positive check (rank >= 0)
);

create index ranked_issues_run_rank_idx on public.ranked_issues (run_id, rank);

-- ---------------------------------------------------------------------------
-- Row level security: owner-only, same shape as migration 0001.
-- ---------------------------------------------------------------------------
alter table public.discovery_runs enable row level security;
alter table public.repo_health    enable row level security;
alter table public.ranked_issues  enable row level security;

create policy discovery_runs_select_own on public.discovery_runs
  for select using (auth.uid() = user_id);
create policy discovery_runs_insert_own on public.discovery_runs
  for insert with check (auth.uid() = user_id);
create policy discovery_runs_delete_own on public.discovery_runs
  for delete using (auth.uid() = user_id);

create policy repo_health_select_own on public.repo_health
  for select using (auth.uid() = user_id);
create policy repo_health_insert_own on public.repo_health
  for insert with check (auth.uid() = user_id);
create policy repo_health_delete_own on public.repo_health
  for delete using (auth.uid() = user_id);

create policy ranked_issues_select_own on public.ranked_issues
  for select using (auth.uid() = user_id);
create policy ranked_issues_insert_own on public.ranked_issues
  for insert with check (auth.uid() = user_id);
create policy ranked_issues_delete_own on public.ranked_issues
  for delete using (auth.uid() = user_id);
