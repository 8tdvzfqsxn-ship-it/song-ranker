// New songs similar to the ones you love, from Deezer's free catalog (no account needed).
// Used by "For you" and "Discover".
// 1. Seeds: the artists behind your 80+ songs, high and recent scores counting most.
// 2. Deezer's "related artists" for each seed; an artist several of your favorites point to ranks higher.
// 3. Their top songs, leaving out what you've ranked, have waiting, or said "Not for me" to.
import { songKey } from './stats.js?v=31';

const API = 'https://api.deezer.com';
const DAY = 86400000;
const norm = (s) => String(s || '').toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// The main artist: "Dua Lipa, DaBaby" or "Calvin Harris & Dua Lipa" -> the first name.
export const mainArtist = (a) => norm(String(a || '').split(/\s*(?:,|;|&|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/i)[0]);

// Deezer doesn't let other websites read its answers directly, so ask the old way (a script tag).
let counter = 0;
function deezer(path) {
  return new Promise((resolve, reject) => {
    const cb = `__dz_cb_${Date.now()}_${counter++}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error("Couldn't reach Deezer. Check your connection and try again.")); }, 10000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = (data) => { cleanup(); data?.error ? reject(new Error(data.error.message || 'Deezer said no')) : resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error("Couldn't reach Deezer. If you use a content blocker, allow api.deezer.com.")); };
    script.src = `${API}${path}${path.includes('?') ? '&' : '?'}output=jsonp&callback=${cb}`;
    document.head.append(script);
  });
}

// Runs jobs a few at a time; Deezer allows about 50 requests every 5 seconds.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch { out[i] = null; }
      await new Promise((r) => setTimeout(r, 120));
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Artist ids are remembered, so later refreshes need fewer requests.
const ID_KEY = 'songrank-deezer-artists';
const loadIds = () => { try { return JSON.parse(localStorage.getItem(ID_KEY)) || {}; } catch { return {}; } };
async function artistId(name, ids) {
  const k = norm(name);
  if (ids[k]) return ids[k];
  const res = await deezer(`/search/artist?q=${encodeURIComponent(name)}&limit=5`);
  const hit = (res.data || []).find((a) => norm(a.name) === k) || (res.data || [])[0];
  if (hit) ids[k] = hit.id;
  return hit?.id || null;
}

// Which artists you love (seeds) and which you don't, from your scores.
// min: the score a song needs to count toward its artist (80 for "songs you love").
export function tasteSeeds(ratings, min = 80) {
  const byArtist = new Map();
  for (const r of ratings) {
    const k = mainArtist(r.artist);
    if (!k) continue;
    if (!byArtist.has(k)) byArtist.set(k, { name: String(r.artist).split(/\s*(?:,|;|&)\s*/)[0], scores: [], weight: 0, best: null });
    const a = byArtist.get(k);
    a.scores.push(r.score);
    const recent = r.rated_at && Date.now() - new Date(r.rated_at) < 180 * DAY ? 1 : 0.7;
    if (r.score >= min) a.weight += (r.score - min + 10) * recent;
    if (!a.best || r.score > a.best.score) a.best = r;
  }
  const all = [...byArtist.entries()];
  const seeds = all.filter(([, a]) => a.weight > 0).sort((x, y) => y[1].weight - x[1].weight).slice(0, 8).map(([k, a]) => ({ key: k, ...a }));
  const disliked = new Set(all.filter(([, a]) => a.scores.reduce((s, x) => s + x, 0) / a.scores.length < 55).map(([k]) => k));
  return { seeds, disliked, known: new Set(byArtist.keys()) };
}

const byLine = (b) => `${b?.title} by ${String(b?.artist).split(/\s*,\s*/)[0]}`;

// "For you": new songs like your 80+ songs, plus one more from each of your top 3 artists.
export function buildForYou({ ratings, unranked, notForMe, onProgress }) {
  return buildRecs({ ratings, from: ratings, unranked, notForMe, onProgress, own: true, minSeeds: 2 });
}

// Builds a list of new songs.
// from: the ranked songs to start from (all of them, or one moment, genre or decade).
// reach: 'close' (artists like yours) or 'far' (artists like those, one step further out).
// own: also add a song from each of your top 3 artists. onProgress(text) reports what it's doing.
export async function buildRecs({ ratings, from, unranked, notForMe, reach = 'close', own = false, minSeeds = 1, size = 30, onProgress = () => {} }) {
  // A small starting point (one moment, say) uses its 70+ songs when it has too few 80+ ones.
  let { seeds } = tasteSeeds(from, 80);
  if (seeds.length < minSeeds && from !== ratings) seeds = tasteSeeds(from, 70).seeds;
  if (seeds.length < minSeeds) return { needMore: true, songs: [] };
  const { disliked, known } = tasteSeeds(ratings);
  const ids = loadIds();
  const skipArtist = (k) => disliked.has(k) || (notForMe.artists[k] || 0) >= 2;
  const skipSong = new Set([...ratings, ...unranked].map(songKey).concat(notForMe.songs));
  const seedKeys = new Set(seeds.map((s) => s.key));

  onProgress(`Looking at ${seeds.length === 1 ? 'your favorite artist' : `your ${seeds.length} favorite artists`}…`);
  const seedIds = await pool(seeds, 4, (s) => artistId(s.name, ids));
  try { localStorage.setItem(ID_KEY, JSON.stringify(ids)); } catch { /* fine */ }

  onProgress('Finding artists like them…');
  const related = await pool(seedIds, 4, (id) => (id ? deezer(`/artist/${id}/related?limit=12`) : null));
  // Scores each related artist: an artist several of your favorites point to ranks higher.
  // root: which of your favorites it came from, for the "Because you love…" line.
  const tally = (lists, weightOf, rootOf, because, cand, skip) => lists.forEach((res, si) => {
    (res?.data || []).forEach((a, i) => {
      const k = norm(a.name);
      if (skipArtist(k) || seedKeys.has(k) || skip.has(a.id)) return;
      const add = weightOf(si) * (1 - i / 15) * (known.has(k) ? 0.5 : 1); // new-to-you artists first
      const c = cand.get(a.id) || { id: a.id, name: a.name, score: 0, because: null, root: null, top: 0 };
      c.score += add;
      if (add > c.top) { c.top = add; c.because = because(si); c.root = rootOf(si); }
      cand.set(a.id, c);
    });
  });
  const near = new Map();
  tally(related, (si) => seeds[si].weight, (si) => seeds[si], (si) => `Because you love ${byLine(seeds[si].best)}`, near, new Set());
  let picks = [...near.values()].sort((a, b) => b.score - a.score);

  if (reach === 'far') {
    // One step further: artists like the closest matches, leaving out the close ones themselves.
    onProgress('Going a step further out…');
    const hops = picks.slice(0, 8);
    const far = await pool(hops, 4, (p) => deezer(`/artist/${p.id}/related?limit=12`));
    const farCand = new Map();
    tally(far, (si) => hops[si].score, (si) => hops[si].root,
      (si) => `Like ${hops[si].name}, who's like ${byLine(hops[si].root.best)}`, farCand, new Set(near.keys()));
    // Mostly the far artists, with a few close ones mixed in.
    picks = [...[...farCand.values()].sort((a, b) => b.score - a.score).slice(0, 12), ...picks.slice(0, 3)];
  } else picks = picks.slice(0, 14);
  if (own) seedIds.slice(0, 3).forEach((id, i) => { if (id) picks.push({ id, name: seeds[i].name, own: true, because: `More from ${seeds[i].name}, one of your favorites` }); });

  onProgress(`Picking songs from ${picks.length} artists…`);
  const tops = await pool(picks, 4, (p) => deezer(`/artist/${p.id}/top?limit=8`));
  const lists = picks.map((p, i) => (tops[i]?.data || [])
    .map((t) => ({
      song_id: `dz:${t.id}`,
      title: t.title_short || t.title,
      artist: t.artist?.name || p.name,
      album: t.album?.title || null,
      artwork_url: t.album?.cover_medium || null,
      preview_url: t.preview || null,
      because: p.because,
    }))
    .filter((s) => !skipSong.has(songKey(s)) && !s.title.match(/\b(live|karaoke|instrumental)\b/i))
    .slice(0, p.own ? 1 : 2));
  // Take turns between artists so one doesn't fill the list.
  const songs = [];
  for (let round = 0; round < 2; round++) for (const l of lists) if (l[round]) songs.push(l[round]);
  return { songs: songs.slice(0, size) };
}

// Deezer's preview links stop working after about 15 minutes; get fresh ones for a saved list.
export async function freshPreviews(songs) {
  const res = await pool(songs, 4, (x) => (x.song_id.startsWith('dz:') ? deezer(`/track/${x.song_id.slice(3)}`) : null));
  return songs.map((x, i) => (res[i]?.preview ? { ...x, preview_url: res[i].preview } : x));
}
