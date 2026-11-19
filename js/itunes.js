// Song search using Apple's free iTunes Search API (no account or key needed).
// Uses JSONP so it works from any web page, including GitHub Pages.

let counter = 0;

export function searchSongs(term, limit = 8) {
  return new Promise((resolve, reject) => {
    const cb = `__itunes_cb_${Date.now()}_${counter++}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('Search timed out')); }, 8000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = (data) => {
      cleanup();
      // The catalog often lists the same song twice (single and album); keep one.
      const seen = new Set();
      const songs = (data.results || []).filter((r) => r.trackId).map(toSong).filter((s) => {
        const k = `${s.title}|${s.artist}`.toLowerCase();
        return seen.has(k) ? false : seen.add(k);
      });
      resolve(songs.slice(0, limit));
    };
    script.onerror = () => { cleanup(); reject(new Error('Could not reach the song catalog')); };
    const params = new URLSearchParams({ term, entity: 'song', media: 'music', limit: String(limit + 6), callback: cb });
    script.src = `https://itunes.apple.com/search?${params}`;
    document.head.append(script);
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
