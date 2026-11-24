-- IMEX League: enable shared app-state writes for the VARDRID referee flow.
-- Run this migration in Supabase Dashboard > SQL Editor.
--
-- Security note: VARDRID is a shared client-side gate, not strong authentication.
-- Anyone who can inspect the public frontend can discover/bypass it. These policies
-- therefore allow anonymous clients to write the single league row (id = 'main').
-- Use a server-side Edge Function and per-user authorization before using this for
-- sensitive or high-stakes official records.

drop policy if exists "app_state: escritura anon" on public.app_state;
create policy "app_state: escritura anon"
  on public.app_state for insert
  to anon
  with check (id = 'main');

drop policy if exists "app_state: actualización anon" on public.app_state;
create policy "app_state: actualización anon"
  on public.app_state for update
  to anon
  using (id = 'main')
  with check (id = 'main');

grant select, insert, update on public.app_state to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.app_state;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;
