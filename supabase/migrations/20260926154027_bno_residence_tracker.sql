-- Additive BNO storage. No example travel or personal settings are inserted.
create table public.travel_flights (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  departure_airport jsonb not null, arrival_airport jsonb not null,
  departure_at timestamptz not null, arrival_at timestamptz not null,
  flight_number text not null default '', airline text not null default '', booking_reference text not null default '', notes text not null default '',
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (arrival_at > departure_at), check (char_length(notes) <= 10000),
  check (jsonb_typeof(departure_airport) = 'object' and departure_airport ?& array['code','countryCode','timezone','uk']),
  check (jsonb_typeof(arrival_airport) = 'object' and arrival_airport ?& array['code','countryCode','timezone','uk']),
  unique (user_id, id)
);
create index travel_flights_user_departure_idx on public.travel_flights(user_id, departure_at);
create table public.manual_trips (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  departed_uk_date date not null, returned_uk_date date, countries text[] not null default '{}',
  departure_location text not null default '', return_location text not null default '', notes text not null default '',
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (returned_uk_date is null or returned_uk_date >= departed_uk_date), check (char_length(notes) <= 10000), unique(user_id, id)
);
create index manual_trips_user_departure_idx on public.manual_trips(user_id, departed_uk_date);
create table public.residency_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  bno_start_date date, ilr_date date, citizenship_application_date date,
  planning_mode text not null default 'official' check (planning_mode in ('official','conservative')),
  warning_thresholds integer[] not null default '{70,85,95}', coverage_start date,
  initial_location text not null default 'unknown' check (initial_location in ('uk','outside','unknown')),
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ilr_date is null or bno_start_date is null or ilr_date >= bno_start_date),
  check (cardinality(warning_thresholds) = 3 and warning_thresholds[1] > 0 and warning_thresholds[1] < warning_thresholds[2] and warning_thresholds[2] < warning_thresholds[3] and warning_thresholds[3] < 100)
);
create table public.planned_trips (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  departure_date date not null, return_date date not null, destination text not null default '',
  departure_airport jsonb, arrival_airport jsonb, notes text not null default '',
  status text not null default 'planned' check (status in ('planned','converted','fulfilled')),
  converted_manual_id uuid, flight_ids uuid[] not null default '{}',
  version bigint not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (return_date >= departure_date), check (char_length(notes) <= 10000),
  foreign key (user_id, converted_manual_id) references public.manual_trips(user_id, id) on delete set null (converted_manual_id)
);
create index planned_trips_user_departure_idx on public.planned_trips(user_id, departure_date);
create index planned_trips_manual_idx on public.planned_trips(user_id, converted_manual_id);

create function private.bno_record_version() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'Record ownership cannot change'; end if;
    new.version := old.version + 1; new.created_at := old.created_at;
  else new.version := 1; new.created_at := now(); end if;
  new.updated_at := now(); return new;
end; $$;
revoke all on function private.bno_record_version() from PUBLIC, anon, authenticated;

create function private.bno_validate_plan_links() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists (select 1 from unnest(new.flight_ids) as f(id) where not exists (select 1 from public.travel_flights t where t.id = f.id and t.user_id = new.user_id)) then
    raise exception 'Plan flight links must belong to the same user';
  end if;
  return new;
end; $$;
revoke all on function private.bno_validate_plan_links() from PUBLIC, anon, authenticated;
create trigger planned_trip_links before insert or update on public.planned_trips for each row execute function private.bno_validate_plan_links();

do $$ declare t text; begin
  foreach t in array array['travel_flights','manual_trips','residency_settings','planned_trips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t || '_owner', t);
    execute format('revoke all on public.%I from PUBLIC, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.bno_record_version()', t || '_version', t);
  end loop;
end $$;

-- Invoker functions retain RLS; each RPC is one atomic database transaction.
create function public.bno_convert_plan(plan_id uuid, expected_version bigint) returns uuid language plpgsql security invoker set search_path = '' as $$
declare p public.planned_trips; actual_id uuid;
begin
  select * into p from public.planned_trips where id = plan_id and user_id = (select auth.uid()) for update;
  if not found then raise exception 'Plan not found'; end if;
  if p.status = 'converted' and p.converted_manual_id is not null then return p.converted_manual_id; end if;
  if p.version <> expected_version or p.status <> 'planned' then raise exception 'Plan changed; refresh before converting'; end if;
  if p.return_date > (now() at time zone 'Europe/London')::date then raise exception 'Future travel cannot be converted to actual history'; end if;
  insert into public.manual_trips(user_id, departed_uk_date, returned_uk_date, countries, departure_location, return_location, notes)
  values(p.user_id, p.departure_date, p.return_date, array[p.destination], coalesce(p.departure_airport->>'code',''), coalesce(p.arrival_airport->>'code',''), p.notes)
  returning id into actual_id;
  update public.planned_trips set status = 'converted', converted_manual_id = actual_id where id = p.id;
  return actual_id;
end; $$;
revoke all on function public.bno_convert_plan(uuid,bigint) from PUBLIC, anon;
grant execute on function public.bno_convert_plan(uuid,bigint) to authenticated;

create function public.bno_delete_flights(records jsonb) returns void language plpgsql security invoker set search_path = '' as $$
declare r record; ids uuid[] := '{}';
begin
  if jsonb_typeof(records) <> 'array' or jsonb_array_length(records) = 0 then raise exception 'Select flights to delete'; end if;
  for r in select * from jsonb_to_recordset(records) as x(id uuid, version bigint) order by id loop
    perform 1 from public.travel_flights f where f.id = r.id and f.user_id = (select auth.uid()) and f.version = r.version for update;
    if not found then raise exception 'Flight changed or unavailable; refresh before deleting'; end if;
    ids := array_append(ids, r.id);
  end loop;
  update public.planned_trips p set flight_ids = array(select unnest(p.flight_ids) except select unnest(ids)),
    status = case when p.status = 'fulfilled' then 'planned' else p.status end
    where p.user_id = (select auth.uid()) and p.flight_ids && ids;
  delete from public.travel_flights where id = any(ids) and user_id = (select auth.uid());
end; $$;
revoke all on function public.bno_delete_flights(jsonb) from PUBLIC, anon;
grant execute on function public.bno_delete_flights(jsonb) to authenticated;
