// Song search using Apple's free iTunes Search API (no account or key needed).
// Tries a normal web request first; falls back to JSONP for browsers that block it.
// Apple allows roughly 20 searches a minute per device, so results are remembered.

const cache = new Map();
let counter = 0;

export async function searchSongs(term, limit = 8) {
  const key = term.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const params = new URLSearchParams({ term, entity: 'song', media: 'music', limit: String(limit + 6) });
  const url = `https://itunes.apple.com/search?${params}`;

  let data;
  try {
    data = await fetchJson(url);
  } catch (e) {
    if (e.rateLimited) throw e;
    data = await jsonp(url); // backup path
  }
  const songs = dedupe((data.results || []).filter((r) => r.trackId).map(toSong)).slice(0, limit);
  cache.set(key, songs);
  return songs;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (res.status === 403 || res.status === 429) {
      const err = new Error('Too many searches in a row. Wait a minute, then try again.');
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`Song catalog answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `__itunes_cb_${Date.now()}_${counter++}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Could not reach the song catalog. Check your connection or try again in a minute.')); }, 8000);
    function cleanup() { clearTimeout(timer); delete window[cb]; script.remove(); }
    window[cb] = (data) => { cleanup(); resolve(data); };
    script.onerror = () => { cleanup(); reject(new Error('Could not reach the song catalog. If you use a content blocker, allow itunes.apple.com, or wait a minute and try again.')); };
    script.src = `${url}&callback=${cb}`;
    document.head.append(script);
  });
}

// The catalog often lists the same song twice (single and album); keep one.
function dedupe(songs) {
  const seen = new Set();
  return songs.filter((s) => {
    const k = `${s.title}|${s.artist}`.toLowerCase();
    return seen.has(k) ? false : seen.add(k);
  });
}

function toSong(r) {
  return {
    song_id: String(r.trackId),
    title: r.trackName,
    artist: r.artistName,
    album: r.collectionName || null,
    genre: r.primaryGenreName || null,
    release_year: r.releaseDate ? new Date(r.releaseDate).getUTCFullYear() : null,
    artwork_url: r.artworkUrl100 ? r.artworkUrl100.replace('100x100', '200x200') : null,
    preview_url: r.previewUrl || null,
  };
}
