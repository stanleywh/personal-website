create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from PUBLIC, anon, authenticated, service_role;

create type public.label_kind as enum ('subject', 'class', 'topic');
create type public.event_origin as enum ('web', 'apple', 'import');
create type public.event_availability as enum ('busy', 'free', 'tentative', 'unavailable');
create type public.conflict_status as enum ('unresolved', 'kept_cloud', 'kept_apple', 'merged');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (
    display_name is null
    or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 50
    )
  ),
  timezone text not null default 'UTC',
  locale text not null default 'en-GB',
  week_start smallint not null default 1 check (week_start in (0, 1, 6)),
  calendar_view text not null default 'dayGridMonth' check (calendar_view in ('dayGridMonth', 'timeGridWeek', 'timeGridDay')),
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind public.label_kind not null,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#78634b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'UTC',
  subject_id uuid references public.labels(id) on delete set null,
  class_id uuid references public.labels(id) on delete set null,
  topic_id uuid references public.labels(id) on delete set null,
  location text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  url text,
  notes text check (char_length(notes) <= 2000),
  availability public.event_availability not null default 'busy',
  travel_minutes integer not null default 0 check (travel_minutes between 0 and 1440),
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  recurrence jsonb,
  recurrence_series_id uuid,
  original_start_at timestamptz,
  participants jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  origin public.event_origin not null default 'web',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_at > start_at)
);

create index events_user_range_idx on public.events (user_id, start_at, end_at) where deleted_at is null;
create index events_deleted_idx on public.events (user_id, deleted_at) where deleted_at is not null;
create index events_user_id_idx on public.events (user_id);
create index events_subject_id_idx on public.events (subject_id);
create index events_class_id_idx on public.events (class_id);
create index events_topic_id_idx on public.events (topic_id);

create table public.event_labels (
  event_id uuid not null references public.events(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, label_id)
);

create index event_labels_label_id_idx on public.event_labels (label_id);
create index event_labels_user_id_idx on public.event_labels (user_id);

create table public.revision_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  subject_id uuid references public.labels(id) on delete set null,
  class_id uuid references public.labels(id) on delete set null,
  topic_id uuid references public.labels(id) on delete set null,
  mastery smallint not null default 1 check (mastery between 1 and 5),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index revision_items_user_id_idx on public.revision_items (user_id);
create index revision_items_subject_id_idx on public.revision_items (subject_id);
create index revision_items_class_id_idx on public.revision_items (class_id);
create index revision_items_topic_id_idx on public.revision_items (topic_id);

create table public.revision_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revision_item_id uuid not null references public.revision_items(id) on delete cascade,
  source_event_id uuid references public.events(id) on delete set null,
  revised_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes between 1 and 1440),
  mastery smallint not null check (mastery between 1 and 5),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index revision_sessions_item_date_idx on public.revision_sessions (revision_item_id, revised_at desc);
create index revision_sessions_user_id_idx on public.revision_sessions (user_id);
create index revision_sessions_source_event_id_idx on public.revision_sessions (source_event_id);

create table public.calendar_sync_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  device_id text not null,
  calendar_identifier text not null,
  event_identifier text,
  external_identifier text,
  occurrence_start_at timestamptz,
  content_hash text not null,
  last_synced_version bigint not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id, event_id, occurrence_start_at)
);

create index calendar_sync_mappings_event_id_idx on public.calendar_sync_mappings (event_id);

create table public.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  device_id text not null,
  cloud_payload jsonb not null,
  apple_payload jsonb not null,
  winner text not null check (winner in ('cloud', 'apple')),
  status public.conflict_status not null default 'unresolved',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index sync_conflicts_user_id_idx on public.sync_conflicts (user_id);
create index sync_conflicts_event_id_idx on public.sync_conflicts (event_id);

create or replace function private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at() from PUBLIC, anon, authenticated, service_role;

create or replace function private.bump_event_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  if row(new.*) is distinct from row(old.*) then
    new.version = greatest(old.version + 1, new.version);
  end if;
  return new;
end;
$$;

revoke execute on function private.bump_event_version() from PUBLIC, anon, authenticated, service_role;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger labels_touch before update on public.labels for each row execute function private.touch_updated_at();
create trigger events_bump before update on public.events for each row execute function private.bump_event_version();
create trigger revision_items_touch before update on public.revision_items for each row execute function private.touch_updated_at();
create trigger revision_sessions_touch before update on public.revision_sessions for each row execute function private.touch_updated_at();
create trigger calendar_sync_mappings_touch before update on public.calendar_sync_mappings for each row execute function private.touch_updated_at();

create or replace function private.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, timezone, locale)
  values (
    new.id,
    case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''))) between 1 and 50
      then btrim(new.raw_user_meta_data ->> 'display_name')
      else null
    end,
    coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC'),
    coalesce(new.raw_user_meta_data ->> 'locale', 'en-GB')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function private.create_profile_for_new_user() from PUBLIC, anon, authenticated, service_role;

create trigger auth_user_profile after insert on auth.users for each row execute function private.create_profile_for_new_user();

insert into public.profiles (id, display_name, timezone, locale)
select
  users.id,
  case
    when char_length(btrim(coalesce(users.raw_user_meta_data ->> 'display_name', ''))) between 1 and 50
    then btrim(users.raw_user_meta_data ->> 'display_name')
    else null
  end,
  coalesce(users.raw_user_meta_data ->> 'timezone', 'UTC'),
  coalesce(users.raw_user_meta_data ->> 'locale', 'en-GB')
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.labels enable row level security;
alter table public.events enable row level security;
alter table public.event_labels enable row level security;
alter table public.revision_items enable row level security;
alter table public.revision_sessions enable row level security;
alter table public.calendar_sync_mappings enable row level security;
alter table public.sync_conflicts enable row level security;

create policy "profiles_owner" on public.profiles for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
create policy "labels_owner" on public.labels for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "events_owner" on public.events for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    subject_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = events.subject_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'subject'
    )
  )
  and (
    class_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = events.class_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'class'
    )
  )
  and (
    topic_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = events.topic_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'topic'
    )
  )
);
create policy "event_labels_owner" on public.event_labels for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.events
    where events.id = event_labels.event_id
      and events.user_id = (select auth.uid())
  )
  and exists (
    select 1
    from public.labels
    where labels.id = event_labels.label_id
      and labels.user_id = (select auth.uid())
  )
);
create policy "revision_items_owner" on public.revision_items for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    subject_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = revision_items.subject_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'subject'
    )
  )
  and (
    class_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = revision_items.class_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'class'
    )
  )
  and (
    topic_id is null
    or exists (
      select 1
      from public.labels
      where labels.id = revision_items.topic_id
        and labels.user_id = (select auth.uid())
        and labels.kind = 'topic'
    )
  )
);
create policy "revision_sessions_owner" on public.revision_sessions for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.revision_items
    where revision_items.id = revision_sessions.revision_item_id
      and revision_items.user_id = (select auth.uid())
  )
  and (
    source_event_id is null
    or exists (
      select 1
      from public.events
      where events.id = revision_sessions.source_event_id
        and events.user_id = (select auth.uid())
    )
  )
);
create policy "calendar_sync_mappings_owner" on public.calendar_sync_mappings for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.events
    where events.id = calendar_sync_mappings.event_id
      and events.user_id = (select auth.uid())
  )
);
create policy "sync_conflicts_owner" on public.sync_conflicts for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    event_id is null
    or exists (
      select 1
      from public.events
      where events.id = sync_conflicts.event_id
        and events.user_id = (select auth.uid())
    )
  )
);

grant usage on schema public to authenticated;
revoke all on table
  public.profiles,
  public.labels,
  public.events,
  public.event_labels,
  public.revision_items,
  public.revision_sessions,
  public.calendar_sync_mappings,
  public.sync_conflicts
from PUBLIC, anon, authenticated;
grant select, insert, update, delete on table
  public.profiles,
  public.labels,
  public.events,
  public.event_labels,
  public.revision_items,
  public.revision_sessions,
  public.calendar_sync_mappings,
  public.sync_conflicts
to authenticated;

-- Run periodically from Supabase Cron once enabled.
create or replace function private.purge_expired_event_tombstones()
returns integer language plpgsql security invoker set search_path = '' as $$
declare deleted_count integer;
begin
  delete from public.events where deleted_at < now() - interval '30 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function private.purge_expired_event_tombstones()
from PUBLIC, anon, authenticated, service_role;
