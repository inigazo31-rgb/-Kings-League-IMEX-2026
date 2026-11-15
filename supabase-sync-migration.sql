-- Kings League IMEX · Safe state synchronization migration
-- Run this migration in the Supabase SQL Editor after backing up public.app_state.
-- Existing payload data is preserved. Writes move from direct table upserts to an
-- authenticated compare-and-swap RPC so concurrent devices cannot silently overwrite.

alter table public.app_state
  add column if not exists version bigint not null default 0;

-- The browser may read the shared league snapshot, but may no longer write directly.
drop policy if exists "app_state: escritura autenticada" on public.app_state;
drop policy if exists "app_state: actualización autenticada" on public.app_state;

create or replace function public.save_app_state(
  p_id text,
  p_expected_version bigint,
  p_payload jsonb
)
returns table (
  saved boolean,
  version bigint,
  payload jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_version bigint;
  current_payload jsonb;
  next_version bigint;
  updated_payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_id is null or length(trim(p_id)) = 0 or p_payload is null then
    raise exception 'Invalid state payload';
  end if;

  update public.app_state as state
     set payload = p_payload,
         updated_at = now(),
         version = state.version + 1
   where state.id = p_id
     and state.version = p_expected_version
  returning state.version, state.payload
       into next_version, updated_payload;

  if found then
    return query select true, next_version, updated_payload;
    return;
  end if;

  select state.version, state.payload
    into current_version, current_payload
    from public.app_state as state
   where state.id = p_id;

  if not found then
    raise exception 'League state row not found';
  end if;

  return query select false, current_version, current_payload;
end;
$$;

revoke all on function public.save_app_state(text, bigint, jsonb) from public;
grant execute on function public.save_app_state(text, bigint, jsonb) to authenticated;

-- Keep anonymous/authenticated read access governed by the existing SELECT policy.
