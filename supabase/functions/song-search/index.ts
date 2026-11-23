// Song search helper on Supabase (Edge Functions → song-search).
// "Verify JWT with legacy secret" is OFF because this code checks the sign-in itself.
// Only signed-in people get results.
//   { term }                      → Apple's catalog (backup for devices that block Apple)
//   { term, source: 'more' }      → other catalogs (Deezer, then MusicBrainz) for songs Apple lacks
//   { source: 'details', album }  → year + genre for a Deezer song, looked up when it's picked
//   { source: 'ytplaylist', list } → the videos in a public or unlisted YouTube playlist (v33). Needs the
//                                    secret YOUTUBE_API_KEY (Edge Functions → Secrets), a free YouTube Data API key.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Ask Supabase who this is; refuse anyone not signed in.
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  if (!auth.startsWith('Bearer ') || !apikey) return json({ error: 'Please sign in first.' }, 401);
  const who = await fetch(Deno.env.get('SUPABASE_URL') + '/auth/v1/user', { headers: { authorization: auth, apikey } });
  if (!who.ok) return json({ error: 'Please sign in first.' }, 401);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const term = String(body.term ?? '').slice(0, 100).trim();

  if (body.source === 'details') return json(await deezerDetails(String(body.album ?? '')));
  if (body.source === 'ytplaylist') {
    const r = await youtubePlaylist(String(body.list ?? ''));
    return json(r, r.error ? 400 : 200);
  }
  if (body.source === 'more') {
    if (!term) return json({ results: [] });
    for (const search of [deezer, musicbrainz]) {
      try {
        const results = await search(term);
        if (results.length) return json({ results });
      } catch { /* try the next catalog */ }
    }
    return json({ results: [] });
  }

  if (!term) return json({ results: [] });
  const params = new URLSearchParams({ term, entity: 'song', media: 'music', limit: '14' });
  const res = await fetch('https://itunes.apple.com/search?' + params);
  return new Response(await res.text(), {
    status: res.status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
});

// deno-lint-ignore no-explicit-any
async function deezer(term: string): Promise<any[]> {
  const res = await fetch('https://api.deezer.com/search?' + new URLSearchParams({ q: term, limit: '10' }),
    { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error('deezer ' + res.status);
  const j = await res.json();
  if (j.error) throw new Error('deezer error');
  // deno-lint-ignore no-explicit-any
  return (j.data ?? []).map((d: any) => ({
    song_id: 'dz:' + d.id,
    title: d.title,
    artist: d.artist?.name ?? 'Unknown artist',
    album: d.album?.title ?? null,
    genre: null,
    release_year: null,
    artwork_url: d.album?.cover_medium ?? null,
    preview_url: d.preview || null,
    details: d.album?.id ? String(d.album.id) : null,
    catalog: 'Deezer',
  }));
}

// deno-lint-ignore no-explicit-any
async function musicbrainz(term: string): Promise<any[]> {
  const res = await fetch('https://musicbrainz.org/ws/2/recording?' + new URLSearchParams({ query: term, fmt: 'json', limit: '10' }),
    { headers: { 'User-Agent': 'SongRanker/1.0 (personal project)' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error('musicbrainz ' + res.status);
  const j = await res.json();
  // deno-lint-ignore no-explicit-any
  return (j.recordings ?? []).map((r: any) => {
    const release = r.releases?.[0];
    const year = r['first-release-date']?.slice(0, 4);
    // deno-lint-ignore no-explicit-any
    const tag = [...(r.tags ?? [])].sort((a: any, b: any) => b.count - a.count)[0];
    return {
      song_id: 'mb:' + r.id,
      title: r.title,
      // deno-lint-ignore no-explicit-any
      artist: (r['artist-credit'] ?? []).map((a: any) => a.name + (a.joinphrase ?? '')).join('') || 'Unknown artist',
      album: release?.title ?? null,
      genre: tag ? tag.name.replace(/\b\w/g, (c: string) => c.toUpperCase()) : null,
      release_year: year ? Number(year) : null,
      artwork_url: release ? `https://coverartarchive.org/release/${release.id}/front-250` : null,
      preview_url: null,
      details: null,
      catalog: 'MusicBrainz',
    };
  });
}

async function deezerDetails(album: string) {
  if (!/^\d+$/.test(album)) return {};
  try {
    const res = await fetch('https://api.deezer.com/album/' + album, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    return {
      release_year: j.release_date ? Number(String(j.release_date).slice(0, 4)) : null,
      genre: j.genres?.data?.[0]?.name ?? null,
    };
  } catch {
    return {};
  }
}

// The titles and channels of a public or unlisted YouTube playlist, 50 at a time (up to 2,000 songs).
// YouTube's official Data API; each page of 50 costs 1 unit of the free 10,000-a-day allowance.
// deno-lint-ignore no-explicit-any
async function youtubePlaylist(list: string): Promise<any> {
  if (!/^[\w-]{2,64}$/.test(list)) return { error: "That doesn't look like a playlist link." };
  if (list === 'LM' || list === 'LL') return { error: 'Liked Music is private, so it can\'t be read from a link. Use Google Takeout, or copy those songs into a public or unlisted playlist.' };
  const key = Deno.env.get('YOUTUBE_API_KEY');
  if (!key) return { error: "Playlist links aren't turned on yet." };
  const items: { title: string; channel: string }[] = [];
  let page = '';
  for (let i = 0; i < 40; i++) {
    const p = new URLSearchParams({ part: 'snippet', playlistId: list, maxResults: '50', key,
      fields: 'nextPageToken,items(snippet(title,videoOwnerChannelTitle))' });
    if (page) p.set('pageToken', page);
    const res = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + p, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) {
        return { error: "Couldn't open that playlist. It has to be public or unlisted, not private." };
      }
      return { error: `YouTube didn't answer (error ${res.status}). Try again in a bit.` };
    }
    const j = await res.json();
    for (const it of j.items ?? []) {
      const s = it.snippet;
      if (!s || s.title === 'Private video' || s.title === 'Deleted video') continue;
      items.push({ title: String(s.title).slice(0, 300), channel: String(s.videoOwnerChannelTitle ?? '').slice(0, 200) });
    }
    page = j.nextPageToken;
    if (!page) break;
  }
  return { items };
}
