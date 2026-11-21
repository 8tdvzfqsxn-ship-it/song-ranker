import { createStore, isDemo } from './store.js?v=8';
import { searchSongs } from './itunes.js?v=8';
import {
  tasteStats, compare, songKey, decadeOf, decadeLabel,
  TIERS, tierOf, STALE_DAYS, daysSince, historyBySong, tasteOverTime,
} from './stats.js?v=8';

const SUGGESTED_TAGS = ['Nighttime driving', 'Shower songs', 'Cooking songs', 'Workout', 'Road trip', 'Rainy day', 'Focus', 'Party'];
const COMMON_GENRES = ['Pop', 'Rock', 'Hip-Hop/Rap', 'R&B/Soul', 'Country', 'Alternative', 'Indie', 'Electronic', 'Dance',
  'Jazz', 'Blues', 'Classical', 'Metal', 'Punk', 'Folk', 'Latin', 'Reggae', 'K-Pop', 'Soundtrack', 'Christian & Gospel'];
const NEW_SONG_SCORE = 50; // the middle, so people move the slider on purpose

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const scoreColor = (n) => `hsl(${Math.round(n * 1.25)} 70% 42%)`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

// A colored circle with someone's initials, so it's clear whose score is whose.
const initials = (name) => (String(name || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
const hue = (id) => { let h = 7; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (p, size = '') =>
  `<span class="avatar ${size}" style="background:hsl(${hue(p?.id)} 55% 42%)" title="${esc(p?.display_name)}" aria-hidden="true">${esc(initials(p?.display_name))}</span>`;

let store;
const state = {
  uid: null,
  me: null,
  ratings: [],
  history: [],       // every score I've given, with dates
  view: 'library',
  authMode: 'in',
  filters: { q: '', tag: '', genre: '', decade: '', sort: 'score', stale: false },
  friends: { accepted: [], incoming: [], outgoing: [] },
  comparing: null,   // { friend, ratings }
  search: null,      // { term, results, active, loading, error, heard }
  rating: null,      // { song, score, tags:Set, existing }
  manual: null,      // { title } while adding a song by hand
  guide: false,      // the "How to rank" page is open
};

// ---------------------------------------------------------------- start

boot();

async function boot() {
  if (isDemo) {
    $('#banner').innerHTML = `<div class="banner">Practice mode: saved only in this browser. Friend code <b>SAM123</b> adds a practice friend.</div>`;
  }
  try {
    store = await createStore();
    state.uid = await store.currentUser();
    if (state.uid) await loadAll();
  } catch (e) {
    $('#app').innerHTML = `<p class="err center">Couldn't start: ${esc(e.message)}</p>`;
    return;
  }
  render();
}

async function loadAll() {
  state.me = await store.me();
  state.ratings = await store.ratingsOf(state.uid);
  state.history = await store.historyOf();
  state.friends = await store.friends();
}

// ---------------------------------------------------------------- rendering

function render() {
  $('#who').innerHTML = state.uid
    ? `${avatar(state.me, 'sm')}<span class="muted small">${esc(state.me?.display_name)}</span> <button class="link" data-action="sign-out">Sign out</button>`
    : '';
  $('#app').innerHTML = state.uid ? mainView() : authView();
  renderModal();
}

function authView() {
  const up = state.authMode === 'up';
  return `
  <section class="card auth">
    <h1>Rank every song you love.</h1>
    <p class="muted">Score songs from 1 to 100, tag them for moments, and compare with friends.</p>
    <div class="seg">
      <button class="${!up ? 'on' : ''}" data-action="auth-mode" data-mode="in">Sign in</button>
      <button class="${up ? 'on' : ''}" data-action="auth-mode" data-mode="up">Create account</button>
    </div>
    <form id="auth-form">
      ${up ? `<label>Your name<input name="name" required autocomplete="nickname" placeholder="What friends see"></label>` : ''}
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Password<input name="password" type="password" required minlength="6" autocomplete="${up ? 'new-password' : 'current-password'}"></label>
      <button class="primary" type="submit">${up ? 'Create account' : 'Sign in'}</button>
      <p class="err" id="auth-err"></p>
    </form>
    ${isDemo ? `<p class="muted small">Practice mode accepts any email and password; nothing leaves this browser.</p>` : ''}
  </section>`;
}

// Wide screens (an unfolded iPhone Duo, a tablet, a computer) show two columns:
// My songs on the left, My taste or Friends on the right. Folding switches back.
const wideScreen = matchMedia('(min-width: 700px)');
wideScreen.addEventListener('change', () => { if (state.uid) render(); });

function mainView() {
  const wide = wideScreen.matches;
  const shown = wide && state.view === 'library' ? 'taste' : state.view;
  const tab = (id, label) => `<button class="${shown === id ? 'on' : ''}" data-action="view" data-view="${id}">${label}</button>`;
  const badge = state.friends.incoming.length ? ` <span class="dot">${state.friends.incoming.length}</span>` : '';
  const panel = (v) => v === 'library' ? libraryView() : v === 'taste' ? tasteView() : state.comparing ? compareView() : friendsView();
  const top = `
    <div class="actions-top">
      <button class="primary big" data-action="open-search">＋ Rank a song</button>
    </div>
    <p class="center small guide-link"><button class="link" data-action="open-guide">How should I score songs?</button></p>`;
  if (wide) {
    return `${top}
    <div class="cols">
      <div class="col"><h2 class="col-title">My songs</h2>${libraryView()}</div>
      <div class="col side"><nav class="seg tabs">${tab('taste', 'My taste')}${tab('friends', 'Friends' + badge)}</nav>${panel(shown)}</div>
    </div>`;
  }
  return `${top}
    <nav class="seg tabs">${tab('library', 'My songs')}${tab('taste', 'My taste')}${tab('friends', 'Friends' + badge)}</nav>
    ${panel(state.view)}`;
}

function songRow(r, { right = '', clickable = true, showDate = false } = {}) {
  const meta = [r.release_year, r.genre].filter(Boolean).join(' · ');
  const tags = (r.tags || []).map((t) => `<span class="chip sm">${esc(t)}</span>`).join('');
  const stale = showDate && daysSince(r.rated_at) > STALE_DAYS;
  return `
  <li class="song ${clickable ? 'clickable' : ''}" ${clickable ? `data-action="edit" data-id="${esc(r.song_id)}"` : ''}>
    ${art(r)}
    <div class="info">
      <div class="title">${esc(r.title)}</div>
      <div class="muted small">${esc(r.artist)}${meta ? ' · ' + esc(meta) : ''}</div>
      ${tags ? `<div class="tags">${tags}</div>` : ''}
      ${showDate && r.rated_at ? `<div class="tiny ${stale ? 'stale' : 'muted'}">Ranked ${fmtDate(r.rated_at)}${stale ? ' · time to re-rank?' : ''}</div>` : ''}
    </div>
    ${right || scoreBadge(r.score)}
  </li>`;
}

const art = (r) => r.artwork_url
  ? `<img class="art" src="${esc(r.artwork_url)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'art ph',textContent:'♪'}))">`
  : `<div class="art ph">♪</div>`;
const scoreBadge = (n, label = '') => `<div class="score" style="background:${scoreColor(n)}" title="${esc(label || tierOf(n).name)}">${n}</div>`;
const scoreWith = (p, n) => `<div class="who">${avatar(p, 'xs')}${scoreBadge(n, `${p?.display_name}: ${tierOf(n).name}`)}</div>`;

function libraryView() {
  const f = state.filters;
  const all = state.ratings;
  if (!all.length) {
    return `<div class="empty">No songs yet. Tap <b>Rank a song</b> and start typing a title.</div>`;
  }
  const uniq = (xs) => [...new Set(xs.filter((x) => x != null && x !== ''))];
  const tags = uniq(all.flatMap((r) => r.tags || [])).sort();
  const genres = uniq(all.map((r) => r.genre)).sort();
  const decades = uniq(all.map((r) => decadeOf(r.release_year))).sort();
  const staleCount = all.filter((r) => daysSince(r.rated_at) > STALE_DAYS).length;
  const q = f.q.trim().toLowerCase();
  let list = all.filter((r) =>
    (!q || `${r.title} ${r.artist}`.toLowerCase().includes(q)) &&
    (!f.tag || (r.tags || []).includes(f.tag)) &&
    (!f.genre || r.genre === f.genre) &&
    (!f.decade || String(decadeOf(r.release_year)) === f.decade) &&
    (!f.stale || daysSince(r.rated_at) > STALE_DAYS));
  const sorts = {
    score: (a, b) => b.score - a.score,
    low: (a, b) => a.score - b.score,
    recent: (a, b) => (b.rated_at || '').localeCompare(a.rated_at || ''),
    oldest: (a, b) => (a.rated_at || '').localeCompare(b.rated_at || ''),
    year: (a, b) => (a.release_year || 9999) - (b.release_year || 9999),
  };
  list = [...list].sort(sorts[f.sort] || sorts.score);
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(label)}</option>`;
  return `
  ${staleCount ? `<div class="nudge">${staleCount} song${staleCount > 1 ? 's were' : ' was'} last ranked over 6 months ago. Still feel the same?
    <button class="link" data-action="toggle-stale">${f.stale ? 'Show all songs' : 'Re-rank them'}</button></div>` : ''}
  <div class="filters">
    <input data-filter="q" type="search" placeholder="Filter my songs" value="${esc(f.q)}">
    <select data-filter="tag">${opt('', 'All moments', f.tag)}${tags.map((t) => opt(t, t, f.tag)).join('')}</select>
    <select data-filter="genre">${opt('', 'All genres', f.genre)}${genres.map((g) => opt(g, g, f.genre)).join('')}</select>
    <select data-filter="decade">${opt('', 'All decades', f.decade)}${decades.map((d) => opt(d, decadeLabel(d), f.decade)).join('')}</select>
    <select data-filter="sort">${opt('score', 'Highest first', f.sort)}${opt('low', 'Lowest first', f.sort)}${opt('recent', 'Recently ranked', f.sort)}${opt('oldest', 'Longest since ranked', f.sort)}${opt('year', 'Oldest songs first', f.sort)}</select>
  </div>
  <p class="muted small">${list.length} of ${all.length} songs</p>
  <ul class="songs">${list.map((r) => songRow(r, { showDate: true })).join('') || '<li class="empty">Nothing matches those filters.</li>'}</ul>`;
}

function bars(groups, labelFn) {
  return `<ul class="bars">${groups.map((g) => `
    <li>
      <span class="bl">${esc(labelFn(g.name))}</span>
      <span class="track"><span class="fill" style="width:${g.avg}%;background:${scoreColor(g.avg)}"></span></span>
      <span class="bv">${g.avg}<span class="muted small"> · ${g.count}</span></span>
    </li>`).join('')}</ul>`;
}

function tasteSummary(s, who = 'Your') {
  if (!s.count) return '';
  const parts = [];
  if (s.favDecade) parts.push(`${who} favorite era is the <b>${esc(decadeLabel(s.favDecade.name))}</b> (${s.favDecade.count} song${s.favDecade.count > 1 ? 's' : ''}, averaging ${s.favDecade.avg}).`);
  if (s.favGenre) parts.push(`${who} top genre is <b>${esc(s.favGenre.name)}</b> (${s.favGenre.count} song${s.favGenre.count > 1 ? 's' : ''}, averaging ${s.favGenre.avg}).`);
  return `<p class="headline">${parts.join(' ')}</p>`;
}

function tasteView() {
  const s = tasteStats(state.ratings);
  if (!s.count) return `<div class="empty">Rank a few songs and your taste shows up here.</div>`;
  return `
  <section class="card">
    ${tasteSummary(s)}
    <div class="stats">
      <div><b>${s.count}</b><span class="muted small">songs ranked</span></div>
      <div><b>${s.avg}</b><span class="muted small">average score</span></div>
      <div><b>${s.genres.length}</b><span class="muted small">genres</span></div>
    </div>
    ${s.count < 5 ? `<p class="muted small">Rank a few more songs and these get more accurate.</p>` : ''}
  </section>
  ${overTimeCard()}
  <section class="card"><h2>By decade</h2>${bars(s.decades, decadeLabel)}</section>
  <section class="card"><h2>By genre</h2>${bars(s.genres, (n) => n)}</section>
  ${s.tags.length ? `<section class="card"><h2>Your moments</h2><div class="tags">${s.tags.map((t) =>
    `<button class="chip" data-action="filter-tag" data-tag="${esc(t.name)}">${esc(t.name)} <span class="muted">${t.count}</span></button>`).join('')}</div></section>` : ''}
  <p class="muted small">Bars show your average score; the small number is how many songs. Your favorite is where most of your 80-and-up songs come from, so one perfect score doesn't win on its own.</p>`;
}

// How my scores have moved since I first ranked each song.
function overTimeCard() {
  const t = tasteOverTime(state.ratings, state.history);
  if (!t.changes.length) {
    return `<section class="card"><h2>Taste over time</h2>
      <p class="muted small">Every score you give is kept with its date. Re-rank a song when your feelings change (tap it in My songs), and the changes show up here.</p></section>`;
  }
  const moved = (a, b, label, fmt) => {
    if (!a || !b) return '';
    return a.name === b.name
      ? `Your favorite ${label} is still <b>${esc(fmt(b.name))}</b>.`
      : `Your favorite ${label} moved from <b>${esc(fmt(a.name))}</b> to <b>${esc(fmt(b.name))}</b>.`;
  };
  const change = (c) => `<div class="change"><span class="muted small">${c.first.score} →</span>${scoreBadge(c.rating.score)}
    <span class="delta ${c.delta > 0 ? 'up' : 'down'}">${c.delta > 0 ? '▲' : '▼'}${Math.abs(c.delta)}</span></div>`;
  return `<section class="card"><h2>Taste over time</h2>
    <p class="headline">${moved(t.then.favDecade, t.now.favDecade, 'era', decadeLabel)} ${moved(t.then.favGenre, t.now.favGenre, 'genre', (n) => n)}</p>
    <h3>Biggest changes of heart</h3>
    <ul class="songs">${t.changes.slice(0, 10).map((c) => songRow(c.rating, { right: change(c) })).join('')}</ul>
    <p class="muted small">Left number: your first score. Changes count from your first ranking of each song.</p></section>`;
}

function friendsView() {
  const fr = state.friends;
  const list = (people, buttons) => people.map((p) => `<li class="person"><span class="row">${avatar(p)}${esc(p.display_name)}</span><span class="row">${buttons(p)}</span></li>`).join('');
  return `
  <section class="card">
    <h2>Your friend code</h2>
    <div class="code-row"><span class="code">${esc(state.me?.friend_code)}</span><button data-action="copy-code">Copy invite</button></div>
    <p class="muted small">Send it to a friend. Once they've made an account, they type it in below on their side.</p>
    <form id="friend-form" class="row">
      <input name="code" placeholder="Enter a friend's code" required autocapitalize="characters" maxlength="12">
      <button class="primary" type="submit">Add</button>
    </form>
  </section>
  ${fr.incoming.length ? `<section class="card"><h2>Waiting for you</h2><ul class="people">${list(fr.incoming, (p) =>
    `<button class="primary" data-action="accept" data-id="${esc(p.id)}">Accept</button><button data-action="unfriend" data-id="${esc(p.id)}">Decline</button>`)}</ul></section>` : ''}
  <section class="card"><h2>Friends</h2>
    ${fr.accepted.length ? `<ul class="people">${list(fr.accepted, (p) =>
      `<button class="primary" data-action="compare" data-id="${esc(p.id)}">Compare</button>`)}</ul>` : `<p class="muted">No friends linked yet.</p>`}
  </section>
  ${fr.outgoing.length ? `<section class="card"><h2>Sent, not accepted yet</h2><ul class="people">${list(fr.outgoing, (p) =>
    `<button data-action="unfriend" data-id="${esc(p.id)}">Cancel</button>`)}</ul></section>` : ''}`;
}

function compareView() {
  const { friend, ratings } = state.comparing;
  const me = state.me;
  const c = compare(state.ratings, ratings);
  const theirs = tasteStats(ratings);
  const name = esc(friend.display_name);
  const both = (s) => `<div class="pair">${scoreWith(me, s.mine.score)}${scoreWith(friend, s.theirs.score)}</div>`;
  const legend = `<div class="legend">${avatar(me, 'xs')} You <span class="sep"></span>${avatar(friend, 'xs')} ${name}</div>`;
  return `
  <button class="link" data-action="back-friends">← All friends</button>
  <section class="card">
    <div class="vs">${avatar(me, 'lg')}<span class="muted">&amp;</span>${avatar(friend, 'lg')}</div>
    <h2 class="center">You &amp; ${name}</h2>
    ${c.agreement == null
      ? `<p class="muted center">You haven't ranked any of the same songs yet.</p>`
      : `<p class="headline center">You agree <b>${c.agreement}%</b> on the ${c.shared.length} song${c.shared.length > 1 ? 's' : ''} you've both ranked.</p>`}
    ${tasteSummary(theirs, `${name}'s`)}
  </section>
  <section class="card"><h2>Discover from ${name}</h2>
    <p class="muted small">Songs they rank highly that you haven't ranked. Play a preview, then rank it.</p>
    ${c.discover.length ? `<ul class="songs">${c.discover.map((r) => songRow(r, { clickable: false, right: `
      <div class="row">
        ${r.preview_url ? `<button class="icon" data-action="preview" data-url="${esc(r.preview_url)}" title="Play a preview">▶</button>` : ''}
        ${scoreWith(friend, r.score)}
        <button data-action="rank-from-friend" data-id="${esc(r.song_id)}">Rank</button>
      </div>` })).join('')}</ul>` : `<p class="muted">Nothing new right now.</p>`}
  </section>
  ${c.shared.length ? `<section class="card"><h2>Both ranked</h2>${legend}
    <ul class="songs">${c.shared.map((s) => songRow(s.mine, { right: both(s) })).join('')}</ul></section>` : ''}
  ${c.youCouldShare.length ? `<section class="card"><h2>Songs ${name} hasn't ranked yet</h2>
    <p class="muted small">Your favorites they might not know.</p>
    <ul class="songs">${c.youCouldShare.slice(0, 15).map((r) => songRow(r, { right: scoreWith(me, r.score) })).join('')}</ul></section>` : ''}`;
}

// ---------------------------------------------------------------- modals

function renderModal() {
  const root = $('#modal-root');
  if (state.guide) root.innerHTML = guideModal();
  else if (state.manual) root.innerHTML = manualModal();
  else if (state.rating) root.innerHTML = rateModal();
  else if (state.search) {
    if (!$('#search-input')) {
      root.innerHTML = `
      <div class="overlay" data-action="close-modal-bg">
        <div class="modal" role="dialog" aria-label="Find a song">
          <div class="row"><input id="search-input" type="search" placeholder="Start typing a song title…" autocomplete="off" value="${esc(state.search.term)}">
          <button class="link" data-action="close-modal">Cancel</button></div>
          ${state.search.heard ? `<p class="heard">Heard <b>${esc(state.search.heard)}</b>. Pick the right version:</p>` : ''}
          <ul id="results" class="results"></ul>
          <p class="add-own small muted">Not in the list? <button class="link" data-action="manual-add">Add it yourself</button></p>
          <p class="shazam-tip tiny muted">Don't know the name? Identify it with Shazam (it's in your iPhone's Control Center), then type it here.</p>
        </div>
      </div>`;
      $('#search-input').focus();
    }
    renderResults();
  } else root.innerHTML = '';
}

function renderResults() {
  const s = state.search;
  const el = $('#results');
  if (!el) return;
  if (s.error && !s.results.length) { el.innerHTML = `<li class="err">${esc(s.error)}</li>`; return; }
  if (!s.term.trim()) { el.innerHTML = `<li class="muted small">Try "take on me" or an artist's name.</li>`; return; }
  if (s.loading && !s.results.length) { el.innerHTML = `<li class="muted small">Searching…</li>`; return; }
  if (!s.results.length) { el.innerHTML = `<li class="muted small">No songs found.</li>`; return; }
  el.innerHTML = s.results.map((r, i) => {
    const mine = findMine(r);
    const meta = [r.release_year, r.genre, r.catalog].filter(Boolean).join(' · ');
    return `
    <li class="song clickable ${i === s.active ? 'active' : ''}" data-action="pick" data-i="${i}">
      ${art(r)}
      <div class="info"><div class="title">${highlight(r.title, s.term)}</div>
      <div class="muted small">${esc(r.artist)}${meta ? ' · ' + esc(meta) : ''}</div></div>
      ${mine ? scoreBadge(mine.score, 'Your score') : ''}
    </li>`;
  }).join('') + (s.loading ? `<li class="muted small">Checking more catalogs…</li>` : '');
}

function highlight(title, term) {
  const t = term.trim();
  const i = t ? title.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (i < 0) return esc(title);
  return `${esc(title.slice(0, i))}<mark>${esc(title.slice(i, i + t.length))}</mark>${esc(title.slice(i + t.length))}`;
}

function rateModal() {
  const { song, score, tags, existing } = state.rating;
  const mine = existing ? findMine(song) : null;
  const steps = mine ? historyBySong(state.history).get(mine.song_id) || [] : [];
  const tier = tierOf(score);
  const all = [...new Set([...SUGGESTED_TAGS, ...state.ratings.flatMap((r) => r.tags || []), ...tags])];
  const stale = mine && daysSince(mine.rated_at) > STALE_DAYS;
  return `
  <div class="overlay" data-action="close-modal-bg">
    <div class="modal" role="dialog" aria-label="Rank this song">
      <div class="song big-song">
        ${art(song)}
        <div class="info">
          <div class="title">${esc(song.title)}</div>
          <div class="muted small">${esc(song.artist)}</div>
          <div class="muted small">${esc([song.album, song.release_year, song.genre].filter(Boolean).join(' · '))}</div>
        </div>
        ${song.preview_url ? `<button class="icon" data-action="preview" data-url="${esc(song.preview_url)}" title="Play a preview">▶</button>` : ''}
      </div>
      ${mine ? `<p class="history small ${stale ? 'stale' : 'muted'}">Ranked ${fmtDate(mine.rated_at)}${stale ? ', a while ago. Still feel the same?' : ''}
        ${steps.length > 1 ? `<br>History: ${steps.map((h) => `<b>${h.score}</b> (${fmtDate(h.rated_at)})`).join(' → ')}` : ''}</p>` : ''}
      <div class="dial">
        <div class="score huge" id="score-badge" style="background:${scoreColor(score)}">${score}</div>
        <div class="tier" id="tier-name">${esc(tier.name)}</div>
        <div class="muted small" id="tier-means">${esc(tier.means)}</div>
        <input id="score-range" type="range" min="1" max="100" value="${score}" aria-label="Score from 1 to 100">
        <div class="row between muted small"><span>1</span><button class="link small" data-action="open-guide">How to rank?</button><span>100</span></div>
      </div>
      <h3>Good for… <span class="muted small">(optional)</span></h3>
      <div class="tags">${all.map((t) => `<button class="chip ${tags.has(t) ? 'on' : ''}" data-action="toggle-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <form id="tag-form" class="row"><input name="tag" placeholder="Add your own, like Sunday mornings" maxlength="40"><button type="submit">Add</button></form>
      <div class="row between actions">
        ${existing ? `<button class="danger" data-action="delete-rating">Remove</button>` : '<span></span>'}
        <div class="row"><button data-action="close-modal">Cancel</button><button class="primary" data-action="save-rating">${existing ? 'Save' : 'Add to my songs'}</button></div>
      </div>
    </div>
  </div>`;
}

// The "How to rank" page: one shared meaning for every score.
function guideModal() {
  const counts = new Map();
  for (const r of state.ratings) { const n = tierOf(r.score).name; counts.set(n, (counts.get(n) || 0) + 1); }
  return `
  <div class="overlay" data-action="close-guide-bg">
    <div class="modal guide" role="dialog" aria-label="How to rank">
      <div class="row between"><h2>How to rank</h2><button class="link" data-action="close-guide">${state.rating ? '← Back' : 'Done'}</button></div>
      <p>Everyone on Song Ranker uses the same scale, so comparing with friends is fair. Find the line that matches how the song makes you feel, then fine-tune within its range.</p>
      <ul class="tiers">${TIERS.map((t) => `
        <li>
          <div class="score wide" style="background:${scoreColor(Math.round((t.min + t.max) / 2))}">${t.min === t.max ? t.min : `${t.min}–${t.max}`}</div>
          <div class="info"><b>${esc(t.name)}</b><div class="small">${esc(t.means)}</div></div>
          ${counts.get(t.name) ? `<span class="muted tiny">${counts.get(t.name)} of yours</span>` : ''}
        </li>`).join('')}</ul>
      <h3>Tips</h3>
      <ul class="tips small">
        <li>Most songs you like land between 60 and 79. That's normal, not stingy.</li>
        <li>Save 90 and up for true favorites. If everything is a 95, nothing stands out.</li>
        <li>Stuck? Ask: would I skip it? Seek it out? Put it on any playlist?</li>
        <li>Feelings change. Re-rank any time; your old scores are kept in your history.</li>
      </ul>
    </div>
  </div>`;
}

// Adding a song the catalogs don't have (covers, remixes, uploads).
function manualModal() {
  const genres = [...new Set([...COMMON_GENRES, ...state.ratings.map((r) => r.genre).filter(Boolean)])].sort();
  return `
  <div class="overlay" data-action="close-modal-bg">
    <div class="modal" role="dialog" aria-label="Add a song yourself">
      <h2>Add a song yourself</h2>
      <p class="muted small">For songs the catalogs don't have, like covers, remixes or uploads. Year and genre feed your taste stats.</p>
      <form id="manual-form">
        <label>Song title<input name="title" required maxlength="120" value="${esc(state.manual.title)}"></label>
        <label>Artist<input name="artist" required maxlength="120" autocomplete="off"></label>
        <div class="row">
          <label class="grow">Year <span class="muted">(optional)</span><input name="year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}"></label>
          <label class="grow">Genre <span class="muted">(optional)</span><input name="genre" list="genre-list" maxlength="40" autocomplete="off"></label>
        </div>
        <datalist id="genre-list">${genres.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
        <div class="row between actions">
          <button type="button" data-action="manual-back">← Back to search</button>
          <button class="primary" type="submit">Next: rank it</button>
        </div>
      </form>
    </div>
  </div>`;
}

const findMine = (song) => state.ratings.find((r) => r.song_id === song.song_id) || state.ratings.find((r) => songKey(r) === songKey(song));

function openRating(song) {
  const existing = findMine(song);
  state.search = null;
  state.manual = null;
  state.rating = {
    song: existing ? { ...song, song_id: existing.song_id } : song,
    score: existing?.score ?? NEW_SONG_SCORE,
    tags: new Set(existing?.tags || []),
    existing: !!existing,
  };
  renderModal();
}

// Songs from other catalogs leave out year and genre; look them up when picked.
async function pickResult(song) {
  if (song.details && store.songDetails) {
    try {
      const d = await store.songDetails(song.details);
      song = { ...song, release_year: d.release_year ?? song.release_year, genre: d.genre ?? song.genre };
    } catch { /* rank it without them */ }
  }
  const { details, catalog, ...clean } = song; // eslint-disable-line no-unused-vars
  openRating(clean);
}

function openSearch(term = '', heard = null) {
  state.search = { term, results: [], active: 0, loading: false, error: null, heard };
  renderModal();
  if (term) onSearchInput(term);
}

// ---------------------------------------------------------------- search typing

let searchTimer;
let searchSeq = 0;
function onSearchInput(term) {
  state.search.term = term;
  state.search.active = 0;
  state.search.error = null;
  clearTimeout(searchTimer);
  if (!term.trim()) { state.search.results = []; state.search.loading = false; renderResults(); return; }
  state.search.loading = true;
  renderResults();
  searchTimer = setTimeout(() => runSearch(term.trim()), 400); // wait for a pause in typing
}

// Apple first (it has years and genres); other catalogs fill in songs Apple lacks.
function runSearch(term) {
  const seq = ++searchSeq;
  const current = () => seq === searchSeq && state.search;
  let apple = [], more = [], appleErr = null, pending = 2;
  const show = () => {
    if (!current()) return;
    const seen = new Set(apple.map(songKey));
    state.search.results = [...apple, ...more.filter((m) => !seen.has(songKey(m)) && seen.add(songKey(m)))].slice(0, 14);
    renderResults();
  };
  const finish = () => {
    if (--pending || !current()) return;
    state.search.loading = false;
    if (!state.search.results.length && appleErr) state.search.error = appleErr.message;
    renderResults();
  };
  searchSongs(term, 8, store.searchBackup).then((r) => { apple = r; show(); }, (e) => { appleErr = e; }).finally(finish);
  (store.searchMore ? store.searchMore(term) : Promise.resolve([])).then((r) => { more = r; show(); }, () => {}).finally(finish);
}

// ---------------------------------------------------------------- audio preview

const audio = new Audio();
let playingUrl = null;
function togglePreview(url, btn) {
  document.querySelectorAll('[data-action="preview"]').forEach((b) => { b.textContent = '▶'; });
  if (playingUrl === url && !audio.paused) { audio.pause(); playingUrl = null; return; }
  audio.src = url;
  audio.play().catch(() => toast("Couldn't play the preview"));
  playingUrl = url;
  btn.textContent = '❚❚';
}
audio.addEventListener('ended', () => { playingUrl = null; document.querySelectorAll('[data-action="preview"]').forEach((b) => { b.textContent = '▶'; }); });

// ---------------------------------------------------------------- events

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function act(fn) {
  try { await fn(); } catch (e) { toast(e.message || 'Something went wrong'); }
}

function closeModals() {
  state.search = null; state.rating = null; state.manual = null; state.guide = false;
  audio.pause();
  renderModal();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if ((a === 'close-modal-bg' || a === 'close-guide-bg') && e.target !== el) return; // clicks inside the modal
  e.preventDefault();
  const id = el.dataset.id;

  switch (a) {
    case 'auth-mode': state.authMode = el.dataset.mode; render(); break;
    case 'sign-out': act(async () => {
      await store.signOut();
      Object.assign(state, { uid: null, me: null, ratings: [], history: [], comparing: null, view: 'library' });
      render();
    }); break;
    case 'view': state.view = el.dataset.view; state.comparing = null; render(); if (state.view === 'friends') refreshFriends(); break;
    case 'open-search': openSearch(); break;
    case 'close-modal': case 'close-modal-bg': closeModals(); break;
    case 'pick': pickResult(state.search.results[+el.dataset.i]); break;
    case 'edit': openRating(state.ratings.find((r) => r.song_id === id)); break;
    case 'rank-from-friend': openRating(state.comparing.ratings.find((r) => r.song_id === id)); break;
    case 'open-guide': state.guide = true; renderModal(); break;
    case 'close-guide': case 'close-guide-bg': state.guide = false; renderModal(); break;
    case 'manual-add': state.manual = { title: state.search?.term || '' }; state.search = null; renderModal(); break;
    case 'manual-back': { const term = state.manual?.title || ''; state.manual = null; openSearch(term); break; }
    case 'toggle-stale': state.filters.stale = !state.filters.stale; render(); break;
    case 'toggle-tag': {
      const t = el.dataset.tag;
      state.rating.tags.has(t) ? state.rating.tags.delete(t) : state.rating.tags.add(t);
      el.classList.toggle('on');
      break;
    }
    case 'save-rating': act(async () => {
      const { song, score, tags, existing } = state.rating;
      const prev = existing ? findMine(song) : null;
      // Keep the date when only tags changed, so "ranked on" means the last score change.
      const rated_at = prev && prev.score === score ? prev.rated_at : new Date().toISOString();
      await store.saveRating({ ...song, score, tags: [...tags], rated_at });
      state.ratings = await store.ratingsOf(state.uid);
      state.history = await store.historyOf();
      state.rating = null; audio.pause();
      toast(`Ranked ${song.title}: ${score} · ${tierOf(score).name}`);
      render();
    }); break;
    case 'delete-rating': act(async () => {
      const { song } = state.rating;
      if (!confirm(`Remove "${song.title}" from your songs?`)) return;
      await store.deleteRating(song.song_id);
      state.ratings = await store.ratingsOf(state.uid);
      state.rating = null;
      render();
    }); break;
    case 'preview': togglePreview(el.dataset.url, el); break;
    case 'filter-tag': state.filters = { ...state.filters, tag: el.dataset.tag }; state.view = 'library'; render(); break;
    case 'copy-code': {
      const link = location.href.split(/[?#]/)[0];
      const text = `Rank songs with me on Song Ranker: ${link}\nMy friend code: ${state.me.friend_code}`;
      navigator.clipboard?.writeText(text).then(() => toast('Invite copied. Paste it in a text.'), () => toast(`Your code: ${state.me.friend_code}`));
      break;
    }
    case 'accept': act(async () => { await store.acceptFriend(id); await refreshFriends(); toast('Friend added'); }); break;
    case 'unfriend': act(async () => { await store.removeFriend(id); await refreshFriends(); }); break;
    case 'compare': act(async () => {
      const friend = state.friends.accepted.find((p) => p.id === id);
      state.comparing = { friend, ratings: await store.ratingsOf(id) };
      render();
    }); break;
    case 'back-friends': state.comparing = null; render(); break;
  }
});

async function refreshFriends() {
  state.friends = await store.friends();
  render();
}

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'search-input') onSearchInput(t.value);
  else if (t.id === 'score-range') {
    const n = +t.value;
    state.rating.score = n;
    const b = $('#score-badge');
    b.textContent = n;
    b.style.background = scoreColor(n);
    const tier = tierOf(n);
    $('#tier-name').textContent = tier.name;
    $('#tier-means').textContent = tier.means;
  } else if (t.dataset.filter) {
    state.filters[t.dataset.filter] = t.value;
    const pos = t.selectionStart;
    render();
    if (t.dataset.filter === 'q') { const el = $('[data-filter="q"]'); el.focus(); el.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.guide) { state.guide = false; renderModal(); return; }
    if (state.search || state.rating || state.manual) { closeModals(); return; }
  }
  if (e.target.id !== 'search-input' || !state.search) return;
  const s = state.search;
  if (e.key === 'ArrowDown') { s.active = Math.min(s.active + 1, s.results.length - 1); renderResults(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { s.active = Math.max(s.active - 1, 0); renderResults(); e.preventDefault(); }
  else if (e.key === 'Enter' && s.results[s.active]) { e.preventDefault(); pickResult(s.results[s.active]); }
});

document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'auth-form') {
    act(async () => {
      try {
        if (state.authMode === 'up') {
          const { needsConfirm } = await store.signUp(data.name, data.email, data.password);
          if (needsConfirm) { $('#auth-err').textContent = 'Check your email for a link to confirm your account, then sign in.'; return; }
        } else {
          await store.signIn(data.email, data.password);
        }
        state.uid = await store.currentUser();
        await loadAll();
        render();
      } catch (err) {
        $('#auth-err').textContent = err.message;
      }
    });
  } else if (form.id === 'tag-form') {
    const t = (data.tag || '').trim();
    if (!t) return;
    state.rating.tags.add(t);
    renderModal();
  } else if (form.id === 'manual-form') {
    const year = Number(data.year);
    openRating({
      song_id: `manual:${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      title: data.title.trim(),
      artist: data.artist.trim(),
      album: null,
      genre: (data.genre || '').trim() || null,
      release_year: year >= 1900 ? year : null,
      artwork_url: null,
      preview_url: null,
    });
  } else if (form.id === 'friend-form') {
    act(async () => {
      const msg = await store.addFriend(data.code);
      toast(msg);
      await refreshFriends();
    });
  }
});
