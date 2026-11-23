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

-- ---------------------------------------------------------------- unranked songs (added 2026-11-21)
-- Songs brought in from a music library, waiting to be ranked. Only you can see or change yours.
create table if not exists public.unranked (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null check (char_length(title) <= 200),
  artist text check (char_length(artist) <= 200),
  album text check (char_length(album) <= 200),
  source text check (char_length(source) <= 40),
  added_at timestamptz not null default now()
);
create index if not exists unranked_user_added on public.unranked (user_id, added_at);
alter table public.unranked enable row level security;
drop policy if exists "see own unranked" on public.unranked;
create policy "see own unranked" on public.unranked for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "add own unranked" on public.unranked;
create policy "add own unranked" on public.unranked for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "change own unranked" on public.unranked;
create policy "change own unranked" on public.unranked for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own unranked" on public.unranked;
create policy "remove own unranked" on public.unranked for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on public.unranked to authenticated;
-- Supabase gives new tables a few extra powers by default; this table doesn't need them.
revoke truncate, references, trigger on public.unranked from authenticated;
revoke all on public.unranked from anon;

-- ---------------------------------------------------------------- saved playlists (added 2026-11-22)
-- Playlists made with "Make a playlist" or "Discover" and saved. Only you can see or change yours.
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null default 'mine' check (kind in ('mine', 'discover')),
  songs jsonb not null default '[]' check (jsonb_typeof(songs) = 'array' and jsonb_array_length(songs) <= 500),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists playlists_user_created on public.playlists (user_id, created_at);
alter table public.playlists enable row level security;
drop policy if exists "see own playlists" on public.playlists;
create policy "see own playlists" on public.playlists for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "add own playlists" on public.playlists;
create policy "add own playlists" on public.playlists for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "change own playlists" on public.playlists;
create policy "change own playlists" on public.playlists for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "remove own playlists" on public.playlists;
create policy "remove own playlists" on public.playlists for delete to authenticated
  using (user_id = auth.uid());
grant select, insert, update, delete on public.playlists to authenticated;
revoke truncate, references, trigger on public.playlists from authenticated;
revoke all on public.playlists from anon;

-- ---------------------------------------------------------------- feedback (added 2026-11-22)
-- "Send feedback" in the profile menu: anyone signed in can send ideas or problems. Only the app's keeper
-- (listed in app_keepers) can read them, set a status and add a private note. Senders can't see anyone's feedback.
create table if not exists public.app_keepers (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.app_keepers enable row level security;
drop policy if exists "see if I'm a keeper" on public.app_keepers;
create policy "see if I'm a keeper" on public.app_keepers for select to authenticated
  using (user_id = auth.uid());
grant select on public.app_keepers to authenticated;
revoke all on public.app_keepers from anon;
-- To make yourself the keeper, run once in the SQL editor with your own friend code (never commit it here):
--   insert into public.app_keepers (user_id) select id from public.profiles where friend_code = 'YOURCODE' on conflict do nothing;

create or replace function public.is_keeper() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.app_keepers where user_id = auth.uid()) $$;
revoke all on function public.is_keeper() from public, anon;
grant execute on function public.is_keeper() to authenticated;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  kind text not null default 'idea' check (kind in ('idea', 'problem', 'other')),
  message text not null check (char_length(message) between 1 and 2000),
  app_version text check (char_length(app_version) <= 120),
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'wont')),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists feedback_created on public.feedback (created_at);
alter table public.feedback enable row level security;
drop policy if exists "send feedback" on public.feedback;
create policy "send feedback" on public.feedback for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and note is null);
drop policy if exists "keeper reads feedback" on public.feedback;
create policy "keeper reads feedback" on public.feedback for select to authenticated
  using (public.is_keeper());
drop policy if exists "keeper updates feedback" on public.feedback;
create policy "keeper updates feedback" on public.feedback for update to authenticated
  using (public.is_keeper()) with check (public.is_keeper());
drop policy if exists "keeper removes feedback" on public.feedback;
create policy "keeper removes feedback" on public.feedback for delete to authenticated
  using (public.is_keeper());
grant select, insert, update, delete on public.feedback to authenticated;
revoke truncate, references, trigger on public.feedback from authenticated;
revoke all on public.feedback from anon;
