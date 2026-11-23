// Where accounts, rankings and friends are kept.
// Two versions with the same functions: practice mode (this browser only) and Supabase (live).
// Practice mode leaves out the extras that need a server, like the other catalogs.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js?v=30';

export const isDemo = !SUPABASE_URL || !SUPABASE_ANON_KEY;

const RATING_FIELDS = ['song_id', 'title', 'artist', 'album', 'genre', 'release_year', 'artwork_url', 'preview_url', 'score', 'tags'];
const pick = (r) => Object.fromEntries(RATING_FIELDS.map((f) => [f, r[f] ?? null]));
const UNRANKED_FIELDS = ['title', 'artist', 'album', 'source', 'added_at'];
const pickUnranked = (r) => Object.fromEntries(UNRANKED_FIELDS.map((f) => [f, r[f] ?? null]));
// The Unranked list is a queue: oldest first. Imports get one millisecond apart so they keep their order.
const stamp = (rows) => { const t = Date.now(); return rows.map((r, i) => ({ ...pickUnranked(r), added_at: new Date(t + i).toISOString() })); };
const byAdded = (a, b) => a.added_at.localeCompare(b.added_at);
// Saved playlists keep a copy of each song's details, so they open the same way every time.
const PL_SONG_FIELDS = ['song_id', 'title', 'artist', 'album', 'artwork_url', 'preview_url', 'because'];
const pickPlaylist = (p) => ({
  name: String(p.name || 'My playlist').slice(0, 80),
  kind: p.kind === 'discover' ? 'discover' : 'mine',
  songs: (p.songs || []).slice(0, 500).map((x) => Object.fromEntries(PL_SONG_FIELDS.map((f) => [f, x[f] ?? null]))),
  settings: p.settings || {},
});
// Feedback from the app's users (supabase/setup.sql: feedback). Kept short; the keeper sets status and a note.
const FB_KINDS = ['idea', 'problem', 'other'];
const FB_STATUSES = ['new', 'planned', 'done', 'wont'];
const pickFeedback = (f) => ({
  kind: FB_KINDS.includes(f.kind) ? f.kind : 'other',
  message: String(f.message || '').trim().slice(0, 2000),
  display_name: String(f.display_name || '').slice(0, 80) || null,
  app_version: String(f.app_version || '').slice(0, 120) || null,
});
const pickFeedbackEdit = (f) => Object.fromEntries(Object.entries({
  status: FB_STATUSES.includes(f.status) ? f.status : undefined,
  note: f.note === undefined ? undefined : (String(f.note).trim().slice(0, 2000) || null),
}).filter(([, v]) => v !== undefined));
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

function groupFriends(rows, profiles, uid) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const out = { accepted: [], incoming: [], outgoing: [] };
  for (const f of rows) {
    const otherId = f.requester === uid ? f.addressee : f.requester;
    const p = byId.get(otherId) || { id: otherId, display_name: 'Someone' };
    if (f.status === 'accepted') out.accepted.push(p);
    else if (f.addressee === uid) out.incoming.push(p);
    else out.outgoing.push(p);
  }
  return out;
}

export async function createStore() {
  return isDemo ? demoStore() : supabaseStore();
}

// ---------------------------------------------------------------- practice mode

function demoStore() {
  const KEY = 'songrank-practice-v1';
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) db = seed();
  db.history ||= {};
  db.unranked ||= {};
  db.playlists ||= {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* private window */ } };
  const code = () => Math.random().toString(16).slice(2, 8).toUpperCase();
  let uid = db.session;

  return {
    async currentUser() { return uid && db.users[uid] ? uid : null; },
    async signUp(name, email) {
      email = email.trim().toLowerCase();
      if (db.accounts[email]) throw new Error('That email already has a practice account. Sign in instead.');
      uid = `u-${Date.now()}`;
      db.accounts[email] = uid;
      db.users[uid] = { id: uid, display_name: name.trim() || 'Music fan', friend_code: code() };
      db.ratings[uid] = [];
      db.session = uid; save();
      return { needsConfirm: false };
    },
    async signIn(email) {
      const id = db.accounts[email.trim().toLowerCase()];
      if (!id) throw new Error('No practice account with that email yet. Create one first.');
      uid = id; db.session = uid; save();
    },
    async signOut() { uid = null; db.session = null; save(); },
    async me() { return db.users[uid]; },
    async ratingsOf(id) { return [...(db.ratings[id] || [])].sort((a, b) => b.score - a.score); },
    async historyOf() { return [...(db.history[uid] || [])]; },
    async saveRating(r) {
      const list = db.ratings[uid];
      const row = { ...pick(r), rated_at: r.rated_at || new Date().toISOString() };
      const i = list.findIndex((x) => x.song_id === r.song_id);
      const changed = i < 0 || list[i].score !== row.score;
      if (i >= 0) list[i] = row; else list.push(row);
      if (changed) (db.history[uid] ||= []).push({ song_id: row.song_id, score: row.score, rated_at: row.rated_at });
      save();
    },
    async deleteRating(songId) { db.ratings[uid] = db.ratings[uid].filter((x) => x.song_id !== songId); save(); },
    // Songs brought in from a music library, waiting to be ranked.
    async unranked() { return [...(db.unranked[uid] || [])].sort(byAdded); },
    async addUnranked(rows) {
      let n = 0;
      (db.unranked[uid] ||= []).push(...stamp(rows).map((r) => ({ ...r, id: `un-${Date.now()}-${n++}` })));
      save();
    },
    async removeUnranked(ids) {
      const drop = new Set(ids);
      db.unranked[uid] = (db.unranked[uid] || []).filter((x) => !drop.has(x.id));
      save();
    },
    async clearUnranked() { db.unranked[uid] = []; save(); },
    // Playlists made with "Make a playlist" or "Discover" and saved, newest first.
    async playlists() { return [...(db.playlists[uid] || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async savePlaylist(p) {
      const list = (db.playlists[uid] ||= []);
      const i = p.id ? list.findIndex((x) => x.id === p.id) : -1;
      const row = { ...pickPlaylist(p), id: p.id || `pl-${Date.now()}`, created_at: i >= 0 ? list[i].created_at : new Date().toISOString() };
      if (i >= 0) list[i] = row; else list.push(row);
      save();
      return row;
    },
    async deletePlaylist(id) { db.playlists[uid] = (db.playlists[uid] || []).filter((x) => x.id !== id); save(); },
    // Feedback: in practice mode you're the keeper, so you see your own inbox.
    async sendFeedback(f) {
      const row = pickFeedback(f);
      if (!row.message) throw new Error('Write a few words first.');
      (db.feedback ||= []).push({ ...row, id: `fb-${Date.now()}`, user_id: uid, status: 'new', note: null, created_at: new Date().toISOString() });
      save();
    },
    async isKeeper() { return true; },
    async feedbackList() { return [...(db.feedback || [])].sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    async updateFeedback(id, f) { const x = (db.feedback || []).find((r) => r.id === id); if (x) { Object.assign(x, pickFeedbackEdit(f)); save(); } },
    // Skip = to the back of the line.
    async skipUnranked(id) {
      const x = (db.unranked[uid] || []).find((r) => r.id === id);
      if (x) { x.added_at = new Date().toISOString(); save(); }
    },
    async friends() {
      const rows = db.friendships.filter((f) => f.requester === uid || f.addressee === uid);
      return groupFriends(rows, Object.values(db.users), uid);
    },
    async addFriend(c) {
      const target = Object.values(db.users).find((u) => u.friend_code === c.trim().toUpperCase());
      if (!target) throw new Error('No one has that friend code.');
      if (target.id === uid) throw new Error("That's your own code.");
      const reverse = db.friendships.find((f) => f.requester === target.id && f.addressee === uid);
      if (reverse) { reverse.status = 'accepted'; save(); return 'You are now friends.'; }
      if (db.friendships.some((f) => f.requester === uid && f.addressee === target.id)) return 'Request already sent.';
      // The made-up friend accepts right away so you can try comparing.
      const status = target.id === 'demo-sam' ? 'accepted' : 'pending';
      db.friendships.push({ requester: uid, addressee: target.id, status });
      save();
      return status === 'accepted' ? `You and ${target.display_name} are now friends.` : 'Request sent. They need to accept it.';
    },
    async acceptFriend(id) {
      const f = db.friendships.find((x) => x.requester === id && x.addressee === uid);
      if (f) { f.status = 'accepted'; save(); }
    },
    async removeFriend(id) {
      db.friendships = db.friendships.filter((f) => !((f.requester === uid && f.addressee === id) || (f.requester === id && f.addressee === uid)));
      save();
    },
  };
}

function seed() {
  const s = (title, artist, genre, release_year, score, tags = []) =>
    ({ song_id: `demo-${title}`, title, artist, album: null, genre, release_year, artwork_url: null, preview_url: null, score, tags, rated_at: new Date().toISOString() });
  return {
    session: null,
    accounts: {},
    users: { 'demo-sam': { id: 'demo-sam', display_name: 'Sam (practice friend)', friend_code: 'SAM123' } },
    ratings: {
      'demo-sam': [
        s('Take On Me', 'a-ha', 'Pop', 1985, 91, ['Road trip']),
        s('Africa', 'TOTO', 'Rock', 1982, 95, ['Shower songs']),
        s('Dreams', 'Fleetwood Mac', 'Rock', 1977, 88, ['Nighttime driving']),
        s('Mr. Brightside', 'The Killers', 'Alternative', 2004, 84),
        s('Midnight City', 'M83', 'Electronic', 2011, 90, ['Nighttime driving']),
        s('September', 'Earth, Wind & Fire', 'R&B/Soul', 1978, 86, ['Cooking songs']),
        s('Blinding Lights', 'The Weeknd', 'R&B/Soul', 2019, 72),
        s('Levitating', 'Dua Lipa', 'Pop', 2020, 55),
      ],
    },
    history: {},
    friendships: [],
  };
}

// ---------------------------------------------------------------- live (Supabase)

async function supabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let uid = null;
  const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  // Calls a helper in supabase/functions; turns its error answer into a readable message.
  const call = async (name, body, headers) => {
    const { data, error } = await sb.functions.invoke(name, { body, headers });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    return typeof data === 'string' ? JSON.parse(data) : data;
  };
  const moreCache = new Map();

  return {
    async currentUser() {
      const { data } = await sb.auth.getSession();
      uid = data.session?.user.id || null;
      return uid;
    },
    async signUp(name, email, password) {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { display_name: name.trim() }, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      uid = data.session?.user.id || null;
      return { needsConfirm: !data.session };
    },
    async signIn(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      uid = data.user.id;
    },
    async signOut() { await sb.auth.signOut(); uid = null; },
    async me() { return ok(await sb.from('profiles').select('*').eq('id', uid).single()); },
    async ratingsOf(id) {
      return ok(await sb.from('ratings').select('*').eq('user_id', id).order('score', { ascending: false }));
    },
    async historyOf() {
      return ok(await sb.from('rating_history').select('song_id, score, rated_at').eq('user_id', uid).order('rated_at'));
    },
    // rated_at stays the same when only tags change, so "ranked on" means the last score change.
    async saveRating(r) {
      ok(await sb.from('ratings').upsert({ ...pick(r), user_id: uid, rated_at: r.rated_at || new Date().toISOString() }));
    },
    async deleteRating(songId) {
      ok(await sb.from('ratings').delete().eq('user_id', uid).eq('song_id', songId));
    },
    // Songs brought in from a music library, waiting to be ranked (supabase/setup.sql: unranked).
    async unranked() {
      // Supabase sends at most 1000 rows per request, and a library can be bigger.
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = ok(await sb.from('unranked').select('id, title, artist, album, source, added_at')
          .eq('user_id', uid).order('added_at').order('id').range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) return all;
      }
    },
    async addUnranked(rows) {
      for (const part of chunks(stamp(rows), 500)) {
        ok(await sb.from('unranked').insert(part.map((r) => ({ ...r, user_id: uid }))));
      }
    },
    async removeUnranked(ids) {
      for (const part of chunks(ids, 100)) ok(await sb.from('unranked').delete().eq('user_id', uid).in('id', part));
    },
    async clearUnranked() { ok(await sb.from('unranked').delete().eq('user_id', uid)); },
    // Saved playlists (supabase/setup.sql: playlists), newest first.
    async playlists() {
      return ok(await sb.from('playlists').select('id, name, kind, songs, settings, created_at').eq('user_id', uid).order('created_at', { ascending: false }));
    },
    async savePlaylist(p) {
      const row = { ...pickPlaylist(p), user_id: uid };
      return p.id
        ? ok(await sb.from('playlists').update(row).eq('user_id', uid).eq('id', p.id).select().single())
        : ok(await sb.from('playlists').insert(row).select().single());
    },
    async deletePlaylist(id) { ok(await sb.from('playlists').delete().eq('user_id', uid).eq('id', id)); },
    // Feedback (supabase/setup.sql: feedback). Anyone signed in can send; only the keeper reads and edits.
    async sendFeedback(f) {
      const row = pickFeedback(f);
      if (!row.message) throw new Error('Write a few words first.');
      ok(await sb.from('feedback').insert({ ...row, user_id: uid }));
    },
    async isKeeper() { return ok(await sb.from('app_keepers').select('user_id').eq('user_id', uid)).length > 0; },
    async feedbackList() {
      return ok(await sb.from('feedback').select('id, kind, message, display_name, app_version, status, note, created_at')
        .order('created_at', { ascending: false }).limit(500));
    },
    async updateFeedback(id, f) { ok(await sb.from('feedback').update(pickFeedbackEdit(f)).eq('id', id)); },
    async skipUnranked(id) {
      ok(await sb.from('unranked').update({ added_at: new Date().toISOString() }).eq('user_id', uid).eq('id', id));
    },
    async friends() {
      const rows = ok(await sb.from('friendships').select('*'));
      const ids = [...new Set(rows.map((f) => (f.requester === uid ? f.addressee : f.requester)))];
      const profiles = ids.length ? ok(await sb.from('profiles').select('id, display_name').in('id', ids)) : [];
      return groupFriends(rows, profiles, uid);
    },
    async addFriend(code) { return ok(await sb.rpc('send_friend_request', { code })); },
    async acceptFriend(id) {
      ok(await sb.from('friendships').update({ status: 'accepted' }).eq('requester', id).eq('addressee', uid));
    },
    async removeFriend(id) {
      ok(await sb.from('friendships').delete().eq('requester', uid).eq('addressee', id));
      ok(await sb.from('friendships').delete().eq('requester', id).eq('addressee', uid));
    },

    // Song helpers on Supabase (supabase/functions/song-search).
    // Backup route to Apple's catalog, for devices that block Apple.
    async searchBackup(term) { return call('song-search', { term }); },
    // Other catalogs (Deezer, MusicBrainz) for songs Apple doesn't have.
    async searchMore(term) {
      const key = term.trim().toLowerCase();
      if (!moreCache.has(key)) moreCache.set(key, call('song-search', { term, source: 'more' }).then((d) => d.results || []));
      try { return await moreCache.get(key); } catch (e) { moreCache.delete(key); throw e; }
    },
    // Year and genre for a Deezer song, which its search results leave out.
    async songDetails(album) { return call('song-search', { source: 'details', album }); },
  };
}
