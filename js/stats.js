// Pure functions: taste stats and friend comparisons. No browser needed.

// The same song often appears several times in the catalog (single, album, remaster).
// Match on cleaned-up title + artist so those count as one song.
export function songKey(r) {
  const clean = (s) => (s || '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '')   // drop "(feat. X)", "[Remastered]"
    .replace(/\s+-\s+.*$/, '')         // drop " - 2015 Remaster"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${clean(r.title)}|${clean(r.artist)}`;
}

export const decadeOf = (year) => (year ? Math.floor(year / 10) * 10 : null);
export const decadeLabel = (d) => (d == null ? 'Unknown' : `${d}s`);

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Groups ratings. Each group gets a count of loved songs (80+) and a "smoothed"
// average, so a group with one 100 doesn't beat eight songs averaging 92.
function groups(ratings, keyFn, overall) {
  const map = new Map();
  for (const r of ratings) {
    const k = keyFn(r);
    if (k == null) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  const C = 2;
  return [...map.entries()]
    .map(([name, rs]) => {
      const scores = rs.map((r) => r.score);
      return {
        name,
        count: rs.length,
        avg: Math.round(avg(scores)),
        loved: rs.filter((r) => r.score >= 80).length,
        weight: (scores.reduce((a, b) => a + b, 0) + C * overall) / (rs.length + C),
        top: [...rs].sort((a, b) => b.score - a.score)[0],
      };
    })
    // Favorite = where most of your loved songs (80+) come from; ties go to the higher average.
    .sort((a, b) => b.loved - a.loved || b.weight - a.weight || b.count - a.count);
}

export function tasteStats(ratings) {
  const overall = avg(ratings.map((r) => r.score));
  const genres = groups(ratings, (r) => r.genre || null, overall);
  const decades = groups(ratings, (r) => decadeOf(r.release_year), overall);
  const tagCounts = new Map();
  for (const r of ratings) for (const t of r.tags || []) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  return {
    count: ratings.length,
    avg: Math.round(overall),
    genres,
    decades,
    favGenre: genres[0] || null,
    favDecade: decades[0] || null,
    tags: [...tagCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

export function compare(mine, theirs) {
  const myMap = new Map(mine.map((r) => [songKey(r), r]));
  const theirMap = new Map(theirs.map((r) => [songKey(r), r]));
  const shared = [];
  for (const [k, t] of theirMap) {
    const m = myMap.get(k);
    if (m) shared.push({ mine: m, theirs: t, diff: Math.abs(m.score - t.score) });
  }
  shared.sort((a, b) => (b.mine.score + b.theirs.score) - (a.mine.score + a.theirs.score));
  return {
    shared,
    agreement: shared.length ? Math.round(100 - avg(shared.map((s) => s.diff))) : null,
    discover: theirs.filter((t) => !myMap.has(songKey(t)) && t.score >= 60).sort((a, b) => b.score - a.score),
    youCouldShare: mine.filter((m) => !theirMap.has(songKey(m)) && m.score >= 75).sort((a, b) => b.score - a.score),
  };
}

// ---------------------------------------------------------------- score tiers ("How to rank")
// Shared meaning of a score, so everyone ranks the same way. Highest first.
export const TIERS = [
  { min: 95, max: 100, name: 'All-time', means: "One of the best songs I've ever heard; never skip, ever" },
  { min: 90, max: 94, name: 'Essential', means: "A top favorite; I'd put it on any playlist" },
  { min: 80, max: 89, name: 'Love it', means: 'I seek it out and play it on repeat for a while' },
  { min: 70, max: 79, name: 'Really like it', means: 'Always glad when it comes on; would add it to a playlist' },
  { min: 60, max: 69, name: 'Like it', means: "Good song; I don't skip it, but I don't seek it out" },
  { min: 50, max: 59, name: "It's fine", means: 'Background music; neutral' },
  { min: 40, max: 49, name: 'Meh', means: "I'd probably skip it" },
  { min: 20, max: 39, name: 'Not for me', means: 'I skip it every time' },
  { min: 1, max: 19, name: "Can't stand it", means: "I'd turn it off" },
];
export const tierOf = (score) => TIERS.find((t) => score >= t.min) || TIERS.at(-1);

// ---------------------------------------------------------------- ranking history
export const STALE_DAYS = 180; // nudge to re-rank after about 6 months
export const daysSince = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 864e5 : 0);

// history: [{ song_id, score, rated_at }] for one person; ratings: their current scores.
export function historyBySong(history) {
  const by = new Map();
  for (const h of [...history].sort((a, b) => a.rated_at.localeCompare(b.rated_at))) {
    if (!by.has(h.song_id)) by.set(h.song_id, []);
    by.get(h.song_id).push(h);
  }
  return by;
}

export function tasteOverTime(ratings, history) {
  const by = historyBySong(history);
  const changes = [];
  for (const r of ratings) {
    const steps = by.get(r.song_id);
    if (steps && steps.length > 1 && steps[0].score !== r.score) {
      changes.push({ rating: r, first: steps[0], delta: r.score - steps[0].score });
    }
  }
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const then = ratings.map((r) => {
    const steps = by.get(r.song_id);
    return steps ? { ...r, score: steps[0].score } : r;
  });
  return { changes, then: tasteStats(then), now: tasteStats(ratings) };
}
