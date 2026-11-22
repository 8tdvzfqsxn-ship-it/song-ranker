// "For you": new songs similar to the ones you love, from Deezer's free catalog (no account needed).
// 1. Seeds: the artists behind your 80+ songs, high and recent scores counting most.
// 2. Deezer's "related artists" for each seed; an artist several of your favorites point to ranks higher.
// 3. Their top songs, leaving out what you've ranked, have waiting, or said "Not for me" to.
import { songKey } from './stats.js?v=15';

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
export function tasteSeeds(ratings) {
  const byArtist = new Map();
  for (const r of ratings) {
    const k = mainArtist(r.artist);
    if (!k) continue;
    if (!byArtist.has(k)) byArtist.set(k, { name: String(r.artist).split(/\s*(?:,|;|&)\s*/)[0], scores: [], weight: 0, best: null });
    const a = byArtist.get(k);
    a.scores.push(r.score);
    const recent = r.rated_at && Date.now() - new Date(r.rated_at) < 180 * DAY ? 1 : 0.7;
    if (r.score >= 80) a.weight += (r.score - 70) * recent;
    if (!a.best || r.score > a.best.score) a.best = r;
  }
  const all = [...byArtist.entries()];
  const seeds = all.filter(([, a]) => a.weight > 0).sort((x, y) => y[1].weight - x[1].weight).slice(0, 8).map(([k, a]) => ({ key: k, ...a }));
  const disliked = new Set(all.filter(([, a]) => a.scores.reduce((s, x) => s + x, 0) / a.scores.length < 55).map(([k]) => k));
  return { seeds, disliked, known: new Set(byArtist.keys()) };
}

// Builds the playlist. onProgress(text) reports what it's doing.
export async function buildForYou({ ratings, unranked, notForMe, onProgress = () => {} }) {
  const { seeds, disliked, known } = tasteSeeds(ratings);
  if (seeds.length < 2) return { needMore: true, songs: [] };
  const ids = loadIds();
  const skipArtist = (k) => disliked.has(k) || (notForMe.artists[k] || 0) >= 2;
  const skipSong = new Set([...ratings, ...unranked].map(songKey).concat(notForMe.songs));

  onProgress(`Looking at your ${seeds.length} favorite artists…`);
  const seedIds = await pool(seeds, 4, (s) => artistId(s.name, ids));
  try { localStorage.setItem(ID_KEY, JSON.stringify(ids)); } catch { /* fine */ }

  onProgress('Finding artists like them…');
  const related = await pool(seedIds, 4, (id) => (id ? deezer(`/artist/${id}/related?limit=12`) : null));
  const cand = new Map(); // deezer artist id -> { name, score, because, top }
  related.forEach((res, si) => {
    const seed = seeds[si];
    (res?.data || []).forEach((a, i) => {
      const k = norm(a.name);
      if (skipArtist(k) || seeds.some((s) => s.key === k)) return;
      const add = seed.weight * (1 - i / 15) * (known.has(k) ? 0.5 : 1); // new-to-you artists first
      const c = cand.get(a.id) || { id: a.id, name: a.name, score: 0, because: seed.best, top: 0 };
      c.score += add;
      if (add > c.top) { c.top = add; c.because = seed.best; }
      cand.set(a.id, c);
    });
  });
  const picks = [...cand.values()].sort((a, b) => b.score - a.score).slice(0, 14);
  // A couple of songs you haven't ranked from your own favorite artists, too.
  seedIds.slice(0, 3).forEach((id, i) => { if (id) picks.push({ id, name: seeds[i].name, score: 0, because: seeds[i].best, own: true }); });

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
      because: p.own ? `More from ${p.name}, one of your favorites` : `Because you love ${p.because?.title} by ${String(p.because?.artist).split(/\s*,\s*/)[0]}`,
    }))
    .filter((s) => !skipSong.has(songKey(s)) && !s.title.match(/\b(live|karaoke|instrumental)\b/i))
    .slice(0, p.own ? 1 : 2));
  // Take turns between artists so one doesn't fill the list.
  const songs = [];
  for (let round = 0; round < 2; round++) for (const l of lists) if (l[round]) songs.push(l[round]);
  return { songs: songs.slice(0, 30) };
}

// Deezer's preview links stop working after about 15 minutes; get fresh ones for a saved list.
export async function freshPreviews(songs) {
  const res = await pool(songs, 4, (x) => (x.song_id.startsWith('dz:') ? deezer(`/track/${x.song_id.slice(3)}`) : null));
  return songs.map((x, i) => (res[i]?.preview ? { ...x, preview_url: res[i].preview } : x));
}
