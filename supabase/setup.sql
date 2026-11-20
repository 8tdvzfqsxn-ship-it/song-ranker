-- Song Ranker database setup.
-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- Safe to run again if you need to.

-- People: a display name and a friend code to share.
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default 'Music fan',
  friend_code text unique not null default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

-- One row per song a person has ranked.
create table if not exists public.ratings (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  song_id text not null,
  title text not null,
  artist text not null,
  album text,
  genre text,
  release_year int,
  artwork_url text,
  preview_url text,
  score int not null check (score between 1 and 100),
  tags text[] not null default '{}',
  rated_at timestamptz not null default now(),
  primary key (user_id, song_id)
);

-- Friend links. "pending" until the other person accepts.
create table if not exists public.friendships (
  requester uuid not null default auth.uid() references auth.users on delete cascade,
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- Make a profile automatically when someone signs up.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), 'Music fan'))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helpers for the rules below.
create or replace function public.is_connected(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships
    where (requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid()));
$$;

create or replace function public.are_friends(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where status = 'accepted'
    and ((requester = auth.uid() and addressee = other) or (requester = other and addressee = auth.uid())));
$$;

-- Add a friend by their code. If they already asked you, this accepts.
create or replace function public.send_friend_request(code text) returns text
language plpgsql security definer set search_path = public as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select id into target from profiles where friend_code = upper(trim(code));
  if target is null then raise exception 'No one has that friend code.'; end if;
  if target = auth.uid() then raise exception 'That is your own code.'; end if;
  if exists (select 1 from friendships where requester = target and addressee = auth.uid()) then
    update friendships set status = 'accepted' where requester = target and addressee = auth.uid();
    return 'You are now friends.';
  end if;
  if exists (select 1 from friendships where requester = auth.uid() and addressee = target) then
    return 'Request already sent.';
  end if;
  insert into friendships (requester, addressee) values (auth.uid(), target);
  return 'Request sent. They need to accept it.';
end $$;

-- Rules: who can see and change what. (Row Level Security)
alter table public.profiles enable row level security;
alter table public.ratings enable row level security;
alter table public.friendships enable row level security;

drop policy if exists "see own and connected profiles" on public.profiles;
create policy "see own and connected profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_connected(id));
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "see own and friends' ratings" on public.ratings;
create policy "see own and friends' ratings" on public.ratings for select to authenticated
  using (user_id = auth.uid() or public.are_friends(user_id));
drop policy if exists "add own ratings" on public.ratings;
create policy "add own ratings" on public.ratings for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "change own ratings" on public.ratings;
create policy "change own ratings" on public.ratings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own ratings" on public.ratings;
create policy "remove own ratings" on public.ratings for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "see own friendships" on public.friendships;
create policy "see own friendships" on public.friendships for select to authenticated
  using (auth.uid() in (requester, addressee));
drop policy if exists "accept requests sent to me" on public.friendships;
create policy "accept requests sent to me" on public.friendships for update to authenticated
  using (addressee = auth.uid()) with check (addressee = auth.uid() and status = 'accepted');
drop policy if exists "remove own friendships" on public.friendships;
create policy "remove own friendships" on public.friendships for delete to authenticated
  using (auth.uid() in (requester, addressee));
-- No insert rule on friendships: requests only go through send_friend_request().

-- Let signed-in people reach the tables at all (the rules above still decide which rows).
-- Newer Supabase projects don't grant this automatically. Signed-out visitors get nothing.
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.ratings to authenticated;
grant select, update, delete on public.friendships to authenticated;
revoke all on public.profiles, public.ratings, public.friendships from anon;
revoke execute on function public.is_connected(uuid), public.are_friends(uuid), public.send_friend_request(text) from public, anon;
grant execute on function public.is_connected(uuid), public.are_friends(uuid), public.send_friend_request(text) to authenticated;

-- ---------------------------------------------------------------- ranking history (added 2026-11-20)
-- Every score a person gives a song, with its date, so taste can be seen changing over time.
create table if not exists public.rating_history (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  song_id text not null,
  score int not null check (score between 1 and 100),
  rated_at timestamptz not null default now()
);
create index if not exists rating_history_user_song on public.rating_history (user_id, song_id, rated_at);
alter table public.rating_history enable row level security;
drop policy if exists "see own history" on public.rating_history;
create policy "see own history" on public.rating_history for select to authenticated
  using (user_id = auth.uid());
grant select on public.rating_history to authenticated;
revoke all on public.rating_history from anon;

-- Write a history entry automatically whenever a score is new or changed.
create or replace function public.log_rating() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.score is distinct from old.score then
    insert into rating_history (user_id, song_id, score, rated_at)
    values (new.user_id, new.song_id, new.score, new.rated_at);
  end if;
  return new;
end $$;
drop trigger if exists on_rating_saved on public.ratings;
create trigger on_rating_saved after insert or update on public.ratings
  for each row execute function public.log_rating();
revoke execute on function public.log_rating() from public, anon, authenticated;

-- Rankings made before history existed become its first entries.
insert into public.rating_history (user_id, song_id, score, rated_at)
select r.user_id, r.song_id, r.score, r.rated_at from public.ratings r
where not exists (select 1 from public.rating_history h where h.user_id = r.user_id and h.song_id = r.song_id);
