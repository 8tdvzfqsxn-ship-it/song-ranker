import { createStore, isDemo } from './store.js?v=26';
import { searchSongs } from './itunes.js?v=26';
import {
  tasteStats, compare, songKey, decadeOf, decadeLabel,
  TIERS, tierOf, STALE_DAYS, daysSince, historyBySong, tasteOverTime,
} from './stats.js?v=26';
import { readFileText, parseSongs, sortImport, searchTermFor, detectSource } from './importer.js?v=26';
import { buildForYou, buildRecs, freshPreviews } from './recommend.js?v=26';

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
  leftView: 'library',  // wide screens: My songs or Unranked on the left
  rightView: 'taste',   // and My taste or Friends on the right
  unranked: [],      // songs brought in from a music library, waiting to be ranked (oldest first)
  unShown: 100,      // how many of them the list shows before "Show more"
  importing: null,   // { text, file: {name, text}, artistFirst, parsed } while the Import window is open
  queueItem: null,   // the Unranked (or For you) song being ranked right now
  playlist: null,    // { name, kind, songs } while a playlist is open
  forYou: null,      // { at, songs } the latest "For you" list
  forYouBusy: null,  // progress text while it's being built
  saved: [],         // playlists I made and saved (#12)
  savedOk: true,     // false when the live database doesn't have the playlists table yet
  maker: null,       // the "Make a playlist" / "Discover" window: { mode, ...choices, busy }
  returnTo: null,    // the playlist to go back to after ranking a song from it
  authMode: 'in',
  filters: { q: '', tag: '', genre: '', decade: '', sort: 'score', stale: false, uq: '' },
  friends: { accepted: [], incoming: [], outgoing: [] },
  comparing: null,   // { friend, ratings }
  search: null,      // { term, results, active, loading, error }
  rating: null,      // { song, score, tags:Set, existing }
  manual: null,      // { title } while adding a song by hand
  guide: false,      // the "How to rank" page is open
};

// ---------------------------------------------------------------- start

boot();

// An invite link (#7): the app's address plus ?invite=CODE. The code is kept until the person
// is signed in (even through "confirm your email"), then the friend request goes out by itself.
const INVITE_KEY = 'songrank-invite';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private window */ } };
const inviteLink = () => `${location.origin}${location.pathname}?invite=${encodeURIComponent(state.me?.friend_code || '')}`;
{
  const code = new URLSearchParams(location.search).get('invite');
  if (code) {
    lsSet(INVITE_KEY, code.trim().toUpperCase().slice(0, 12));
    history.replaceState(null, '', location.pathname + location.hash);
  }
  if (lsGet(INVITE_KEY)) state.authMode = 'up';
}
async function claimInvite() {
  const code = lsGet(INVITE_KEY);
  if (!code || !state.me) return;
  lsSet(INVITE_KEY, null);
  if (code === state.me.friend_code) return;
  try {
    const msg = await store.addFriend(code);
    state.friends = await store.friends();
    toast(`Invite: ${msg}`);
  } catch (e) { toast(`Invite: ${e.message}`); }
}

async function boot() {
  if (isDemo) {
    $('#banner').innerHTML = `<div class="banner">Practice mode: saved only in this browser. Friend code <b>SAM123</b> adds a practice friend.</div>`;
  }
  try {
    store = await createStore();
    state.uid = await store.currentUser();
    if (state.uid) { await loadAll(); await claimInvite(); }
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
  // A missing Unranked table (live database not updated yet) shouldn't stop the app.
  try { state.unranked = await store.unranked(); } catch { state.unranked = []; }
  loadForYou();
  try { state.saved = await store.playlists(); state.savedOk = true; } catch { state.saved = []; state.savedOk = false; }
}

// ---------------------------------------------------------------- rendering

function render() {
  $('#who').innerHTML = state.uid ? whoHtml() : '';
  // On wide screens each column scrolls by itself; keep each one's place across redraws
  // (a column starts at the top only when it switches to a different panel).
  const kept = new Map([...document.querySelectorAll('.col[data-key]')].map((c) => [c.dataset.key, c.scrollTop]));
  $('#app').innerHTML = state.uid ? mainView() : authView();
  document.querySelectorAll('.col[data-key]').forEach((c) => { if (kept.has(c.dataset.key)) c.scrollTop = kept.get(c.dataset.key); });
  renderModal();
}

function authView() {
  const up = state.authMode === 'up';
  return `
  <section class="card auth">
    <h1>Rank every song you love.</h1>
    <p class="muted">Score songs from 1 to 100, tag them for moments, and compare with friends.</p>
    ${lsGet(INVITE_KEY) ? `<p class="heard">You've been invited! Create your account (or sign in) and you'll be linked as friends automatically.</p>` : ''}
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

// The profile corner: just the initials circle; tapping it opens a small menu.
const whoHtml = () => `
  <div class="profile">
    <button class="profile-btn" data-action="toggle-profile" aria-haspopup="true" aria-label="Your account">${avatar(state.me)}</button>
    <div class="profile-menu" role="menu">
      <div class="pm-name">${esc(state.me?.display_name)}</div>
      <button class="link small code-copy" data-action="copy-plain-code" title="Copy your friend code">Friend code <b>${esc(state.me?.friend_code)}</b> · copy</button>
      <button class="link small" data-action="share-invite" role="menuitem">Share invite…</button>
      <button class="link danger-link" data-action="sign-out" role="menuitem">Sign out</button>
    </div>
  </div>`;
const closeProfileMenus = () => document.querySelectorAll('.profile.open').forEach((p) => p.classList.remove('open'));
// Tapping anywhere outside the menu closes it.
document.addEventListener('click', (e) => { if (!e.target.closest('.profile')) closeProfileMenus(); }, true);

// Wide screens (an unfolded iPhone Duo, a tablet, a computer) show two columns:
// My songs on the left, My taste or Friends on the right. Folding switches back.
// v19: the iPhone Duo's inside screen. Safari doesn't tell pages where the fold is (checked 2026-11-22), so it's
// found from the screen size: held wide (about 951 × 669) the fold runs down the middle; held tall (about
// 669 × 951) it runs across the middle. Held tall, the two columns stack above and below the fold.
const DUO_TALL_Q = '(min-width: 640px) and (max-width: 699px) and (min-height: 700px)';
const duoTall = matchMedia(DUO_TALL_Q);
// min-height keeps big regular iPhones held sideways (about 956 × 440) out of it.
const duoWide = matchMedia('(min-width: 900px) and (max-width: 1000px) and (min-height: 450px) and (max-height: 700px)');
const wideScreen = matchMedia(`(min-width: 700px), ${DUO_TALL_Q}`);
wideScreen.addEventListener('change', () => { if (state.uid) render(); });
const DUO_LONG = 951;
const DUO_SHORT = 669;
// Where the fold falls on the page when held tall. Safari's toolbars sit above the page, so the page's top is
// that much below the screen's top; the Home Screen app fills the screen and the fold is simply the middle.
const foldY = () => { const screenH = Math.max(innerHeight, DUO_LONG); return Math.round(screenH / 2 - (screenH - innerHeight)); };
// Temporary (v20): the version label also shows the screen size and which layout is in use, so a screenshot
// from the Duo tells us what the app sees. Remove once the half-open layouts are confirmed.
const VERSION = (document.querySelector('.version')?.textContent || '').trim().split(' ')[0];
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function fitFold() {
  const root = document.documentElement;
  const label = document.querySelector('.version');
  if (label) label.textContent = `${VERSION} · ${innerWidth}×${innerHeight} · ${duoTall.matches ? 'Duo tall' : duoWide.matches ? 'Duo wide' : wideScreen.matches ? 'wide' : 'phone'} · ${standalone ? 'app' : 'Safari'}`;
  root.classList.toggle('duo-tall', duoTall.matches);
  root.classList.toggle('duo-wide', duoWide.matches);
  const cols = document.querySelector('.cols');
  const range = document.querySelector('.modal #score-range');
  if (range) range.style.marginTop = '';
  // Held wide, the clock and music area reaches about 190 points down the screen. Sometimes the page starts below
  // a band at the top (it's then shorter than the 669-point screen), so the rail's top moves up by that band.
  if (duoWide.matches) root.style.setProperty('--rail-top', `${Math.max(16, 222 - Math.max(0, DUO_SHORT - innerHeight))}px`);
  if (!duoTall.matches) { if (cols) cols.style.gridTemplateRows = ''; return; }
  const y = foldY();
  root.style.setProperty('--fold-y', `${y}px`);
  // Top column ends 12 points above the fold, the gap sits on it, the bottom column starts 12 below.
  if (cols) cols.style.gridTemplateRows = `${Math.max(140, Math.round(y - cols.getBoundingClientRect().top - 12))}px minmax(0, 1fr)`;
  // Rating window: song and big score above the fold, the slider and everything after it below.
  if (range) {
    const top = range.getBoundingClientRect().top;
    if (top < y + 16) range.style.marginTop = `${parseFloat(getComputedStyle(range).marginTop) + (y + 16 - top)}px`;
  }
}
addEventListener('resize', fitFold);
duoTall.addEventListener('change', fitFold);
duoWide.addEventListener('change', () => { if (state.uid) render(); else fitFold(); });

function mainView() {
  const wide = wideScreen.matches;
  const shown = wide ? state.rightView : state.view;
  const left = state.leftView;
  const tab = (id, label, cur = shown) => `<button class="${cur === id ? 'on' : ''}" data-action="view" data-view="${id}">${label}</button>`;
  const badge = state.friends.incoming.length ? ` <span class="dot">${state.friends.incoming.length}</span>` : '';
  const count = state.unranked.length ? ` <span class="muted small">${state.unranked.length}</span>` : '';
  const panel = (v) => v === 'library' ? libraryView() : v === 'unranked' ? unrankedView() : v === 'taste' ? tasteView() : state.comparing ? compareView() : friendsView();
  const top = `
    <div class="actions-top">
      <button class="primary big" data-action="open-search">＋ Rank a song</button>
    </div>
    <p class="center small guide-link"><button class="link" data-action="open-guide">How should I score songs?</button></p>`;
  if (wide) {
    // Held wide on the Duo, the quick-button rail down the right edge replaces the top row (v23).
    // Elsewhere: one top row with logo, Rank button and profile (the usual header is hidden).
    return `${duoWide.matches ? railHtml() : `
    <div class="wide-top">
      <div class="brand"><img class="logo" src="img/logo.svg?v=26" alt="">Song Ranker</div>
      <div class="wide-rank">
        <button class="primary big" data-action="open-search">＋ Rank a song</button>
        <button class="link small" data-action="open-guide">How should I score songs?</button>
      </div>
      <div class="who-wide">${whoHtml()}</div>
    </div>`}
    <div class="cols">
      <div class="col" data-key="left:${left}"><nav class="seg tabs">${tab('library', 'My songs', left)}${tab('unranked', 'Unranked' + count, left)}</nav>${panel(left)}</div>
      <div class="col side" data-key="${shown}:${esc(state.comparing?.friend.id || '')}"><nav class="seg tabs">${tab('taste', 'My taste')}${tab('friends', 'Friends' + badge)}</nav>${panel(shown)}</div>
    </div>`;
  }
  return `${top}
    <nav class="seg tabs four">${tab('library', 'My songs')}${tab('unranked', 'Unranked')}${tab('taste', 'My taste')}${tab('friends', 'Friends' + badge)}</nav>
    ${panel(state.view)}`;
}

// v23: quick buttons in the strip under the clock and icons when the Duo is held wide.
const ICON = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  next: '<path d="M6 5l9 7-9 7z"/><path d="M18 5v14"/>',
  spark: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  list: '<path d="M4 6h11M4 11h11M4 16h6"/><path d="M19 8v9"/><circle cx="17" cy="17" r="2"/>',
  find: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17.3v.2"/>',
};
const icon = (k) => `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg></span>`;
function railHtml() {
  const n = state.unranked.length;
  const btn = (attrs, k, label, extra = '', cls = '') =>
    `<button class="rail-btn ${cls}" ${attrs} aria-label="${label}" title="${label}">${icon(k)}<span class="rl">${label}</span>${extra}</button>`;
  return `
  <nav class="rail" aria-label="Quick buttons">
    ${btn('data-action="open-search"', 'plus', 'Rank', '', 'main')}
    ${n ? btn('data-action="un-next"', 'next', 'Next', `<b class="rail-count">${n > 99 ? '99+' : n}</b>`) : btn('data-action="import-open"', 'next', 'Import')}
    ${btn(state.forYou?.songs?.length ? 'data-action="open-playlist" data-id="foryou"' : 'data-action="fy-build"', 'spark', 'For you')}
    ${btn('data-action="maker-open" data-mode="mine"', 'list', 'Playlist')}
    ${btn('data-action="rail-find"', 'find', 'Find')}
    ${btn('data-action="open-guide"', 'help', 'Scoring')}
    <div class="rail-me">${whoHtml()}</div>
  </nav>`;
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
    return `<div class="empty">No songs yet. Tap <b>Rank a song</b> and start typing a title,
      or bring in your music library with <button class="link" data-action="import-open">Import songs</button>.</div>`;
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
  <div class="row between view-row">
    <p class="muted small">${list.length} of ${all.length} songs</p>
    <div class="seg layouts" role="group" aria-label="How to show my songs">${LAYOUTS.map(([v, label]) =>
      `<button class="${layout() === v ? 'on' : ''}" data-action="set-layout" data-layout="${v}" title="${label}" aria-label="${label}" aria-pressed="${layout() === v}">${label}</button>`).join('')}</div>
  </div>
  ${list.length ? songsIn(list) : '<ul class="songs"><li class="empty">Nothing matches those filters.</li></ul>'}`;
}

// v18: four ways to show My songs. The choice is remembered on this device.
const LAYOUTS = [['list', 'List'], ['compact', 'Compact'], ['grid', 'Grid'], ['tiers', 'Tiers']];
const layout = () => (state.layout ??= LAYOUTS.some(([v]) => v === lsGet('songrank-layout')) ? lsGet('songrank-layout') : 'list');
const bigArt = (url) => url?.replace('200x200', '400x400');
// A cover, or a tile tinted with the song's score color showing the title's first letter.
const tileArt = (r) => {
  const letter = esc((r.title || '♪').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '♪');
  const ph = `<div class="cover ph" style="--c:${scoreColor(r.score)}">${letter}</div>`;
  return r.artwork_url
    ? `<img class="cover" src="${esc(bigArt(r.artwork_url))}" alt="" loading="lazy" onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${ph}</template>`
    : ph;
};
const tile = (r) => `
  <li class="tile clickable" data-action="edit" data-id="${esc(r.song_id)}" title="${esc(`${r.title} – ${r.artist}`)}">
    <div class="cover-wrap">${tileArt(r)}${scoreBadge(r.score)}</div>
    <div class="title">${esc(r.title)}</div>
    <div class="muted small">${esc(r.artist)}</div>
  </li>`;
const compactRow = (r) => `
  <li class="song compact clickable" data-action="edit" data-id="${esc(r.song_id)}">
    ${scoreBadge(r.score)}
    <span class="title">${esc(r.title)}</span>
    <span class="muted small">${esc(r.artist)}</span>
  </li>`;
function songsIn(list) {
  const v = layout();
  if (v === 'compact') return `<ul class="songs compact-list">${list.map(compactRow).join('')}</ul>`;
  if (v === 'grid') return `<ul class="grid">${list.map(tile).join('')}</ul>`;
  if (v === 'tiers') {
    return TIERS.map((t) => {
      const songs = list.filter((r) => tierOf(r.score) === t);
      if (!songs.length) return '';
      return `<section class="tier-group">
        <h3 class="tier-h">${scoreBadge(t.max, t.name).replace(`>${t.max}<`, `>${t.min}–${t.max}<`)}<span>${esc(t.name)}</span><span class="muted small">${songs.length}</span></h3>
        <ul class="tier-row">${songs.map(tile).join('')}</ul>
      </section>`;
    }).join('');
  }
  return `<ul class="songs">${list.map((r) => songRow(r, { showDate: true })).join('')}</ul>`;
}

// Songs brought in from a music library, waiting their turn. Oldest first; Skip sends one to the back.
function unrankedView() {
  const all = state.unranked;
  if (!all.length) {
    return `<div class="empty">
      <p>Bring in the songs from your music app, and they wait here until you rank them.</p>
      <button class="primary" data-action="import-open">Import songs</button></div>`;
  }
  const q = state.filters.uq.trim().toLowerCase();
  const list = q ? all.filter((u) => `${u.title} ${u.artist}`.toLowerCase().includes(q)) : all;
  const shown = list.slice(0, state.unShown);
  const row = (u) => `
    <li class="song un">
      <div class="info">
        <div class="title">${esc(u.title)}</div>
        <div class="muted small">${esc([u.artist, u.album].filter(Boolean).join(' · ') || 'Artist unknown')}</div>
      </div>
      <div class="row un-btns">
        <button class="primary" data-action="un-rank" data-id="${esc(u.id)}">Rank</button>
        <button data-action="un-skip" data-id="${esc(u.id)}" title="Not now: move it to the end">Skip</button>
        <button class="icon" data-action="un-remove" data-id="${esc(u.id)}" title="Remove from the list" aria-label="Remove ${esc(u.title)}">✕</button>
      </div>
    </li>`;
  return `
  <div class="row un-head">
    <button class="primary grow" data-action="un-next">Rank the next one</button>
    <button data-action="import-open">Import songs</button>
  </div>
  <input class="un-filter" data-filter="uq" type="search" placeholder="Find in Unranked" value="${esc(state.filters.uq)}">
  <p class="muted small">${q ? `${list.length} of ${all.length}` : all.length} song${all.length === 1 ? '' : 's'} waiting. <b>Rank</b> finds it in the catalog; <b>Skip</b> moves it to the end.</p>
  <ul class="songs">${shown.map(row).join('') || '<li class="empty">Nothing matches.</li>'}</ul>
  ${list.length > shown.length ? `<button class="more" data-action="un-more">Show more (${list.length - shown.length} left)</button>` : ''}
  <p class="center"><button class="link small danger-link-plain" data-action="un-clear">Remove all ${all.length} from Unranked</button></p>`;
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
  ${playlistsCard()}
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

// ---------------------------------------------------------------- playlists (#9) and For you (#11)

// Playlists made from my rankings: favorites, each moment tag, each decade and genre I love.
function myPlaylists() {
  const top = (xs, min = 0) => xs.filter((r) => r.score >= min).sort((a, b) => b.score - a.score);
  const R = state.ratings;
  const lists = [
    { id: 'p:90', name: 'My 90+ songs', songs: top(R, 90) },
    { id: 'p:80', name: 'Songs I love (80+)', songs: top(R, 80) },
  ];
  const s = tasteStats(R);
  for (const t of s.tags) lists.push({ id: `t:${t.name}`, name: t.name, songs: top(R.filter((r) => (r.tags || []).includes(t.name))) });
  for (const d of s.decades) {
    const songs = top(R.filter((r) => decadeOf(r.release_year) === d.name), 70);
    if (songs.length >= 3) lists.push({ id: `d:${d.name}`, name: `Best of the ${decadeLabel(d.name)}`, songs });
  }
  for (const g of s.genres) {
    const songs = top(R.filter((r) => r.genre === g.name), 70);
    if (songs.length >= 3) lists.push({ id: `g:${g.name}`, name: `Top ${g.name}`, songs });
  }
  return lists.filter((l) => l.songs.length);
}

function playlistsCard() {
  const fy = state.forYou;
  const lists = myPlaylists();
  return `
  <section class="card">
    <h2>Playlists</h2>
    <div class="foryou-row">
      <div><b>For you</b><div class="muted small">${state.forYouBusy ? esc(state.forYouBusy)
        : fy?.songs?.length ? `${fy.songs.length} new songs like your favorites · made ${fmtDate(fy.at)}` : 'New songs similar to the ones you love most.'}</div></div>
      ${state.forYouBusy ? '' : fy?.songs?.length
        ? `<div class="row"><button class="primary" data-action="open-playlist" data-id="foryou">Open</button><button data-action="fy-build" title="Find a fresh set">↻</button></div>`
        : `<button class="primary" data-action="fy-build">Find new music</button>`}
    </div>
    <div class="pl-make">
      <button data-action="maker-open" data-mode="mine"><b>＋ Make a playlist</b><span class="muted small">From your rankings: scores, moments, decades, genres</span></button>
      <button data-action="maker-open" data-mode="discover"><b>Discover</b><span class="muted small">New songs, starting from a moment, genre or decade</span></button>
    </div>
    ${state.saved.length ? `<h3>Saved</h3><ul class="people pl-list">${state.saved.map((l) => `
      <li class="person clickable" data-action="open-playlist" data-id="s:${esc(l.id)}">
        <span>${esc(l.name)}${l.kind === 'discover' ? ' <span class="chip sm">Discover</span>' : ''}</span><span class="muted small">${l.songs.length} song${l.songs.length === 1 ? '' : 's'} ›</span>
      </li>`).join('')}</ul><h3>Made from your rankings</h3>` : ''}
    <ul class="people pl-list">${lists.map((l) => `
      <li class="person clickable" data-action="open-playlist" data-id="${esc(l.id)}">
        <span>${esc(l.name)}</span><span class="muted small">${l.songs.length} song${l.songs.length === 1 ? '' : 's'} ›</span>
      </li>`).join('')}</ul>
  </section>`;
}

function openPlaylist(id) {
  if (id === 'foryou') {
    state.playlist = { id, name: 'For you', kind: 'foryou', songs: state.forYou?.songs || [] };
    const fy = state.forYou;
    if (fy && Date.now() - new Date(fy.previewsAt || fy.at) > 10 * 60000) {
      freshPreviews(fy.songs).then((songs) => {
        if (state.forYou !== fy) return;
        const byId = new Map(songs.map((x) => [x.song_id, x.preview_url]));
        fy.songs = fy.songs.map((x) => ({ ...x, preview_url: byId.get(x.song_id) || x.preview_url }));
        fy.previewsAt = new Date().toISOString();
        saveForYou();
        if (state.playlist?.kind === 'foryou' && !playingUrl) renderModal();
      }).catch(() => {});
    }
  } else if (id.startsWith('s:')) {
    const row = state.saved.find((x) => x.id === id.slice(2));
    if (!row) return;
    state.playlist = { id, savedId: row.id, name: row.name, kind: 'saved', discover: row.kind === 'discover', settings: row.settings, songs: row.songs };
    // Preview links from Deezer expire, so a saved list gets fresh ones when it opens.
    const pl = state.playlist;
    if (pl.songs.some((x) => x.song_id?.startsWith('dz:'))) {
      freshPreviews(pl.songs).then((songs) => {
        if (state.playlist !== pl) return;
        pl.songs = songs;
        if (!playingUrl) renderModal();
      }).catch(() => {});
    }
  } else {
    const l = myPlaylists().find((x) => x.id === id);
    if (!l) return;
    state.playlist = { ...l, kind: 'mine' };
  }
  renderModal();
}

function playlistModal() {
  const pl = state.playlist;
  const fy = pl.kind === 'foryou';
  // For you leaves out anything ranked or saved since it was made.
  const done = new Set([...state.ratings, ...state.unranked].map(songKey));
  const songs = fy ? (state.forYou?.songs || []).filter((x) => !done.has(songKey(x)))
    : pl.kind === 'new' && pl.discover ? pl.songs.filter((x) => !done.has(songKey(x))) : pl.songs;
  pl.songs = songs;
  // A new song (from Deezer) not ranked yet gets preview, Rank, save and Not for me; anything ranked shows my score.
  const row = (x) => {
    if (fy) return fyRow(x);
    const mine = findMine(x);
    if (mine) return songRow(mine, { clickable: false });
    if (x.song_id?.startsWith('dz:')) return fyRow(x);
    return songRow(x, { clickable: false, right: '<span></span>' });
  };
  const canSave = pl.kind === 'new';
  const fyRow = (x) => `
    <li class="song fy">
      <button class="art-btn" ${x.preview_url ? `data-action="preview" data-url="${esc(x.preview_url)}"` : 'disabled'} title="Play a preview" aria-label="Play a preview of ${esc(x.title)}">
        ${art(x)}<span class="art-play" aria-hidden="true">▶</span></button>
      <div class="info">
        <div class="title">${esc(x.title)}</div>
        <div class="muted small">${esc(x.artist)}</div>
        <div class="tiny muted">${esc(x.because || '')}</div>
      </div>
      <div class="row un-btns">
        <button class="primary" data-action="fy-rank" data-id="${esc(x.song_id)}">Rank</button>
        <button class="icon" data-action="fy-save" data-id="${esc(x.song_id)}" title="Save to Unranked for later" aria-label="Save for later">＋</button>
        <button class="icon" data-action="fy-nope" data-id="${esc(x.song_id)}" title="Not for me" aria-label="Not for me">✕</button>
      </div>
    </li>`;
  return `
  <div class="overlay" data-action="close-modal-bg">
    <div class="modal playlist" role="dialog" aria-label="${esc(pl.name)}">
      <div class="row between"><h2>${canSave ? (pl.discover ? 'New songs for you' : 'Your new playlist') : esc(pl.name)}</h2><button class="link" data-action="close-playlist">${canSave ? 'Close' : 'Done'}</button></div>
      ${canSave ? `
      <div class="row pl-name"><input id="pl-name" maxlength="80" value="${esc(pl.name)}" aria-label="Playlist name">
        <button class="primary" data-action="pl-save">Save</button></div>
      <p class="tiny muted">${state.savedOk ? 'Saved playlists show up under My taste on all your devices.' : ''}
        <button class="link" data-action="pl-again">← Change the choices</button></p>` : ''}
      ${pl.discover && !fy ? `<p class="muted small">Tap a cover to hear a preview. <b>Rank</b> it, <b>＋</b> save it to Unranked for later, or <b>✕</b> if it's not for you.</p>` : ''}
      ${fy ? `<p class="muted small">Songs from artists like your favorites, found in Deezer's free catalog. Tap a cover to hear a preview.
        <b>Rank</b> it, <b>＋</b> save it for later, or <b>✕</b> if it's not for you. Your scores teach it what to find next time.</p>` : ''}
      <p class="muted small">${songs.length} song${songs.length === 1 ? '' : 's'}</p>
      <ul class="songs">${songs.map(row).join('') || `<li class="empty">${fy ? 'Nothing left here. Tap ↻ for a fresh set.' : 'Nothing left here.'}</li>`}</ul>
      ${songs.length ? `
      <h3>Put it in your music app</h3>
      <div class="row wrap pl-actions">
        <button class="primary" data-action="pl-download">Download file</button>
        <button data-action="pl-copy">Copy list</button>
        <button data-action="pl-share">Share</button>
      </div>
      <p class="tiny muted">For YouTube Music (or any app): download the file, open the free site
        <a href="https://www.tunemymusic.com/transfer/file-to-youtube-music" target="_blank" rel="noopener">TuneMyMusic</a>,
        choose <b>File</b> as the source and upload it, then pick <b>YouTube Music</b> as the destination.</p>` : ''}
      ${pl.kind === 'saved' ? `<p class="tiny"><button class="link danger-link-plain" data-action="pl-delete">Delete this playlist</button></p>` : ''}
    </div>
  </div>`;
}

const playlistText = (pl) => pl.songs.map((x) => `${x.title} – ${x.artist}`).join('\n');
// A spreadsheet file (CSV) that transfer sites read: one song per row.
function downloadPlaylist(pl) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['Track name,Artist name,Album', ...pl.songs.map((x) => [x.title, x.artist, x.album].map(cell).join(','))].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' })),
    download: `${pl.name.replace(/[^\w\s-]+/g, '').trim() || 'playlist'}.csv`,
  });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Downloaded. Upload it at TuneMyMusic to send it to YouTube Music.');
}

// "For you" is kept on this device for a while, so it doesn't have to be rebuilt every visit.
const fyKey = () => `songrank-foryou-${state.uid}`;
const nopeKey = () => `songrank-notforme-${state.uid}`;
const loadNope = () => { try { return JSON.parse(lsGet(nopeKey())) || { songs: [], artists: {} }; } catch { return { songs: [], artists: {} }; } };
function loadForYou() { try { state.forYou = JSON.parse(lsGet(fyKey())); } catch { state.forYou = null; } }
const saveForYou = () => lsSet(fyKey(), JSON.stringify(state.forYou));

async function makeForYou() {
  if (state.forYouBusy) return;
  state.forYouBusy = 'Starting…';
  render();
  try {
    const res = await buildForYou({
      ratings: state.ratings, unranked: state.unranked, notForMe: loadNope(),
      onProgress: (t) => { state.forYouBusy = t; render(); },
    });
    if (res.needMore) { toast('Score a few more songs 80 or higher (from at least 2 artists) so it knows what you love.'); return; }
    if (!res.songs.length) { toast("Couldn't find new songs right now. Try again later."); return; }
    state.forYou = { at: new Date().toISOString(), songs: res.songs };
    saveForYou();
    state.forYouBusy = null;
    openPlaylist('foryou');
  } catch (e) {
    toast(e.message);
  } finally {
    state.forYouBusy = null;
    render();
  }
}

// The song a For you / Discover row is about.
const plSong = (id) => (state.playlist?.songs || []).find((x) => x.song_id === id) || (state.forYou?.songs || []).find((x) => x.song_id === id);

// Take a song off For you or a Discover list. "Not for me" is remembered; two of those from one artist
// and it stops suggesting them. A saved playlist keeps songs saved for later, but drops "Not for me" ones.
function dropForYou(id, nope) {
  const song = plSong(id);
  if (!song) return;
  if (nope) {
    const n = loadNope();
    n.songs = [...new Set([...n.songs, songKey(song)])].slice(-500);
    const a = song.artist.toLowerCase().split(/\s*(?:,|&)\s*/)[0].replace(/[^a-z0-9]+/g, ' ').trim();
    n.artists[a] = (n.artists[a] || 0) + 1;
    lsSet(nopeKey(), JSON.stringify(n));
  }
  if (state.forYou?.songs?.some((x) => x.song_id === id)) {
    state.forYou.songs = state.forYou.songs.filter((x) => x.song_id !== id);
    saveForYou();
  }
  const pl = state.playlist;
  if (pl && pl.kind !== 'foryou' && (nope || pl.kind !== 'saved')) {
    pl.songs = pl.songs.filter((x) => x.song_id !== id);
    if (pl.kind === 'saved') act(async () => { await store.savePlaylist({ id: pl.savedId, name: pl.name, kind: pl.discover ? 'discover' : 'mine', songs: pl.songs, settings: pl.settings }); state.saved = await store.playlists(); });
  }
  renderModal();
}

// ---------------------------------------------------------------- Make a playlist and Discover (#12)

const REACH_HINT = {
  close: 'Close: artists similar to your favorites.',
  far: "Further out: artists similar to those, a step away from your favorites, so more you won't have heard of.",
};
const HOUR_SONGS = 16; // songs average about 3¾ minutes
const LENGTHS = [['10', '10'], ['25', '25'], ['50', '50'], ['hour', '~1 hour'], ['all', 'All']];
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
let makerPrefs = { mine: null, discover: null }; // the last choices, so "Change the choices" starts from them

function openMaker(mode) {
  closeProfileMenus();
  state.maker = makerPrefs[mode] ? { ...makerPrefs[mode], busy: null }
    : mode === 'mine'
      ? { mode, min: 75, max: 100, tags: [], decades: [], genres: [], length: '25', order: 'top' }
      : { mode, start: 'love', reach: 'close' };
  renderModal();
}

// The songs from my rankings that fit the choices, best first.
function makerMatches(m) {
  const has = (list, v) => !list.length || list.includes(String(v));
  return state.ratings
    .filter((r) => r.score >= m.min && r.score <= m.max && has(m.decades, decadeOf(r.release_year)) && has(m.genres, r.genre)
      && (!m.tags.length || (r.tags || []).some((t) => m.tags.includes(t))))
    .sort((a, b) => b.score - a.score);
}
const makerSize = (m) => (m.length === 'hour' ? HOUR_SONGS : m.length === 'all' ? Infinity : +m.length);

// What a Discover starting point means: which of my ranked songs it starts from, and its name.
function discoverStart(start) {
  const [kind, ...rest] = start.split(':');
  const v = rest.join(':');
  if (kind === 't') return { label: v, from: state.ratings.filter((r) => (r.tags || []).includes(v)) };
  if (kind === 'g') return { label: v, from: state.ratings.filter((r) => r.genre === v) };
  if (kind === 'd') return { label: decadeLabel(+v), from: state.ratings.filter((r) => String(decadeOf(r.release_year)) === v) };
  return { label: 'Songs I love', from: state.ratings };
}

function makerModal() {
  const m = state.maker;
  const s = tasteStats(state.ratings);
  const chips = (group, items, single = false) => `<div class="tags">${items.map(([v, label, n]) => {
    const on = single ? m[group] === v : m[group].includes(v);
    return `<button class="chip ${on ? 'on' : ''}" data-action="mk-chip" data-group="${group}" data-val="${esc(v)}" ${single ? 'data-single="1"' : ''}>${esc(label)}${n != null ? ` <span class="muted">${n}</span>` : ''}</button>`;
  }).join('')}</div>`;
  const seg = (key, opts) => `<div class="seg">${opts.map(([v, label]) =>
    `<button class="${m[key] === v ? 'on' : ''}" data-action="mk-set" data-key="${key}" data-val="${v}">${label}</button>`).join('')}</div>`;
  const tags = s.tags.map((t) => [t.name, t.name, t.count]);
  const decades = [...s.decades].sort((a, b) => a.name - b.name).map((d) => [String(d.name), decadeLabel(d.name), d.count]);
  const genres = s.genres.map((g) => [g.name, g.name, g.count]);
  const scoreOpts = (sel) => Array.from({ length: 21 }, (_, i) => i * 5).map((n) => `<option ${n === sel ? 'selected' : ''}>${n}</option>`).join('');

  const body = m.mode === 'mine' ? `
      <p class="muted small">Pick what goes in from the songs you've ranked. Leave a group with nothing picked to include all of it.</p>
      <h3>Scores</h3>
      <div class="row mk-scores"><label>From <select id="mk-min">${scoreOpts(m.min)}</select></label>
        <label>to <select id="mk-max">${scoreOpts(m.max)}</select></label></div>
      ${tags.length ? `<h3>Moments</h3>${chips('tags', tags)}` : ''}
      ${decades.length ? `<h3>Decades</h3>${chips('decades', decades)}` : ''}
      ${genres.length ? `<h3>Genres</h3>${chips('genres', genres)}` : ''}
      <h3>How many songs</h3>${seg('length', LENGTHS)}
      <h3>Order</h3>${seg('order', [['top', 'Highest scores first'], ['shuffle', 'Shuffled']])}
      <p class="small mk-count" id="mk-count"></p>
      <button class="primary wide" data-action="maker-go">Make playlist</button>` : `
      <p class="muted small">New songs you haven't ranked, from artists like the ones you score highest. Pick where to start.</p>
      <h3>Start from</h3>
      ${chips('start', [['love', 'All my 80+ songs', null]], true)}
      ${tags.length ? `<p class="tiny muted mk-sub">A moment</p>${chips('start', tags.map(([v, l, n]) => [`t:${v}`, l, n]), true)}` : ''}
      ${genres.length ? `<p class="tiny muted mk-sub">A genre</p>${chips('start', genres.map(([v, l, n]) => [`g:${v}`, l, n]), true)}` : ''}
      ${decades.length ? `<p class="tiny muted mk-sub">A decade</p>${chips('start', decades.map(([v, l, n]) => [`d:${v}`, l, n]), true)}` : ''}
      <h3>How adventurous</h3>${seg('reach', [['close', 'Close to what I like'], ['far', 'Further out']])}
      <p class="tiny muted" id="mk-reach">${REACH_HINT[m.reach]}</p>
      <p class="small mk-count" id="mk-count">${m.busy ? esc(m.busy) : ''}</p>
      <button class="primary wide" data-action="maker-go" ${m.busy ? 'disabled' : ''}>${m.busy ? 'Finding songs…' : 'Find songs'}</button>`;
  return `
  <div class="overlay" data-action="close-modal-bg">
    <div class="modal maker" role="dialog" aria-label="${m.mode === 'mine' ? 'Make a playlist' : 'Discover'}">
      <div class="row between"><h2>${m.mode === 'mine' ? 'Make a playlist' : 'Discover'}</h2><button class="link" data-action="close-modal">Cancel</button></div>
      ${body}
    </div>
  </div>`;
}

// Keeps "N songs match" current without redrawing the window (so it doesn't jump to the top).
function updateMakerCount() {
  const m = state.maker;
  const el = $('#mk-count');
  if (!m || m.mode !== 'mine' || !el) return;
  const n = makerMatches(m).length;
  const take = Math.min(n, makerSize(m));
  el.innerHTML = n ? `<b>${n}</b> song${n === 1 ? '' : 's'} match${n === 1 ? 'es' : ''}${take < n ? `; the playlist takes ${m.order === 'top' ? 'the top' : 'a shuffled'} ${take}` : ''}.`
    : `<span class="err">No songs match. Widen the scores or pick fewer moments, decades or genres.</span>`;
}

function mineName(m) {
  const parts = [...m.tags, ...m.genres, ...m.decades.map((d) => decadeLabel(+d))];
  if (m.min > 0 || m.max < 100) parts.push(m.max === 100 ? `${m.min}+` : `${m.min}–${m.max}`);
  return (parts.length ? parts.join(' · ') : 'All my songs').slice(0, 80);
}

async function makerGo() {
  const m = state.maker;
  if (m.mode === 'mine') {
    const all = makerMatches(m);
    if (!all.length) { updateMakerCount(); return; }
    const size = makerSize(m);
    const songs = m.order === 'shuffle' ? shuffle(all).slice(0, size) : all.slice(0, size);
    makerPrefs.mine = { ...m };
    const settings = { min: m.min, max: m.max, tags: m.tags, decades: m.decades, genres: m.genres, length: m.length, order: m.order };
    state.maker = null;
    state.playlist = { id: 'new', name: mineName(m), kind: 'new', discover: false, settings, songs };
    renderModal();
    return;
  }
  if (m.busy) return;
  const start = discoverStart(m.start);
  // Shows progress in place, without redrawing the window.
  const say = (t) => {
    m.busy = t || null;
    const c = $('#mk-count'), b = $('[data-action="maker-go"]');
    if (state.maker !== m || !c) return;
    c.textContent = t || '';
    b.disabled = !!t; b.textContent = t ? 'Finding songs…' : 'Find songs';
  };
  say('Starting…');
  try {
    const res = await buildRecs({
      ratings: state.ratings, from: start.from, unranked: state.unranked, notForMe: loadNope(),
      reach: m.reach, onProgress: say,
    });
    if (state.maker !== m) return; // closed while it worked
    if (res.needMore) { say(''); toast(`Score a few ${start.label === 'Songs I love' ? 'songs 80 or higher' : `"${start.label}" songs 70 or higher`} first, so it knows what you love there.`); return; }
    if (!res.songs.length) { say(''); toast("Couldn't find new songs right now. Try again later."); return; }
    makerPrefs.discover = { ...m, busy: null };
    state.maker = null;
    state.playlist = { id: 'new', name: `Discover: ${start.label}${m.reach === 'far' ? ' (further out)' : ''}`.slice(0, 80), kind: 'new', discover: true,
      settings: { start: m.start, reach: m.reach }, songs: res.songs };
    renderModal();
  } catch (e) {
    say('');
    toast(e.message);
  } finally {
    if (state.maker === m && m.busy) say('');
  }
}

function copyText(text, done) {
  navigator.clipboard?.writeText(text).then(() => toast(done), () => toast("Couldn't copy here. Try Share instead."));
}
const inviteText = () => `Rank songs with me on Song Ranker! Open this link to make an account and we'll be linked as friends:\n${inviteLink()}\n(My friend code: ${state.me.friend_code})`;

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
    <div class="code-row"><span class="code">${esc(state.me?.friend_code)}</span>
      <div class="row"><button class="primary" data-action="share-invite">Share invite</button><button data-action="copy-code">Copy</button></div></div>
    <p class="muted small">Send the invite to a friend. When they open its link and make an account, the friend request comes to you automatically. They can also type your code below on their side.</p>
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
  else if (state.maker) { root.innerHTML = makerModal(); updateMakerCount(); }
  else if (state.playlist) root.innerHTML = playlistModal();
  else if (state.importing) {
    if (!$('#import-text')) root.innerHTML = importModal();
    renderImportSummary();
  } else if (state.search) {
    if (!$('#search-input')) {
      root.innerHTML = `
      <div class="overlay" data-action="close-modal-bg">
        <div class="modal" role="dialog" aria-label="Find a song">
          <div class="row"><input id="search-input" type="search" placeholder="Start typing a song title…" autocomplete="off" value="${esc(state.search.term)}">
          <button class="link" data-action="close-modal">Cancel</button></div>
          ${state.queueItem ? `<p class="heard">${state.queueItem.from ? `From ${esc(state.queueItem.from)}` : 'From your Unranked list'}: <b>${esc(state.queueItem.title)}</b>${state.queueItem.artist ? ` · ${esc(state.queueItem.artist)}` : ''}. Pick the right version:</p>` : ''}
          <ul id="results" class="results"></ul>
          <p class="add-own small muted">Not in the list? <button class="link" data-action="manual-add">Add it yourself</button></p>
          <p class="shazam-tip tiny muted">Don't know the name? Identify it with Shazam (it's in your iPhone's Control Center), then type it here.</p>
        </div>
      </div>`;
      $('#search-input').focus();
    }
    renderResults();
  } else root.innerHTML = '';
  fitFold();
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
      </div>
      ${song.preview_url ? `<button class="play-btn" data-action="preview" data-url="${esc(song.preview_url)}" data-play="▶ Play preview" data-pause="❚❚ Pause">▶ Play preview</button>` : ''}
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
        <label>Artist<input name="artist" required maxlength="120" autocomplete="off" value="${esc(state.manual.artist || '')}"></label>
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

// The Import window: paste a list or choose a file. Nothing is looked up in a catalog here,
// so big libraries come in instantly; each song is matched when you tap Rank.
function importModal() {
  const im = state.importing;
  return `
  <div class="overlay" data-action="close-modal-bg">
    <div class="modal import" role="dialog" aria-label="Import songs">
      <div class="row between"><h2>Import songs</h2><button class="link" data-action="close-modal">Cancel</button></div>
      <p class="muted small">Bring in songs from your music app. They wait in your Unranked list until you rank them. Songs you've already ranked are left out.</p>
      <details class="how">
        <summary>How do I get my songs out of my music app?</summary>
        <dl class="small">
          <dt>Spotify</dt>
          <dd>Open <a href="https://exportify.net" target="_blank" rel="noopener">exportify.net</a> (free) and sign in with Spotify.
            Tap <b>Export</b> next to Liked Songs or a playlist, then choose that file below.</dd>
          <dt>Apple Music on a Mac</dt>
          <dd>In the Music app, click a playlist (or <b>Songs</b> for your whole library), then
            <b>File → Library → Export Playlist…</b>, pick <b>Unicode Text</b>, and choose that file below.</dd>
          <dt>YouTube Music</dt>
          <dd>At <a href="https://takeout.google.com" target="_blank" rel="noopener">takeout.google.com</a>, choose
            <b>Deselect all</b>, tick only <b>YouTube and YouTube Music</b>, and export. Open the download and choose
            the file named <b>music library songs.csv</b> below. It holds only songs you saved to your library;
            for liked songs and playlists, use a free transfer site (next).</dd>
          <dt>Any other app, or iPhone</dt>
          <dd>A free transfer site like <a href="https://www.tunemymusic.com" target="_blank" rel="noopener">TuneMyMusic</a>
            can save any app's playlists as a file: pick your app, then <b>Export to file</b> (CSV).
            Or paste any list with one "Song – Artist" per line.</dd>
        </dl>
      </details>
      <label for="import-text">Paste a list, one song per line</label>
      <textarea id="import-text" rows="6" spellcheck="false" placeholder="Take On Me – a-ha&#10;Dreams – Fleetwood Mac">${esc(im.text)}</textarea>
      <div class="row between import-order">
        <span class="muted small">Each line is</span>
        <div class="seg">
          <button class="${!im.artistFirst ? 'on' : ''}" data-action="import-order" data-first="title">Song – Artist</button>
          <button class="${im.artistFirst ? 'on' : ''}" data-action="import-order" data-first="artist">Artist – Song</button>
        </div>
      </div>
      <p class="center muted small or">or</p>
      <div id="import-file-row"></div>
      <div id="import-summary" class="import-summary"></div>
    </div>
  </div>`;
}

// The part of the Import window that changes as you paste or pick a file.
function renderImportSummary() {
  const im = state.importing;
  const fileRow = $('#import-file-row');
  if (!im || !fileRow) return;
  fileRow.innerHTML = im.file
    ? `<div class="file-chip"><span>📄 ${esc(im.file.name)}</span><button class="link" data-action="import-clear-file">Use pasted list instead</button></div>`
    : `<label class="file-btn">Choose a file (CSV or text)<input id="import-file" type="file" accept=".csv,.txt,.tsv,.tab,text/plain,text/csv,text/tab-separated-values"></label>`;
  const sum = $('#import-summary');
  const p = im.parsed;
  if (!p) { sum.innerHTML = ''; return; }
  const n = p.fresh.length;
  const left = [p.ranked && `${p.ranked} already ranked`, p.repeats && `${p.repeats} already waiting or listed twice`].filter(Boolean).join(', ');
  sum.innerHTML = `
    <p class="small"><b>${n} new song${n === 1 ? '' : 's'}</b>${left ? ` <span class="muted">(skipping ${left})</span>` : ''}</p>
    ${!n && !p.ranked && !p.repeats && im.file ? `<p class="small err">No song titles found in this file. Some exports (like Google Takeout's playlists) only list
      codes, not titles. For YouTube Music, use <b>music library songs.csv</b>, or a free transfer site for likes and playlists.</p>` : ''}
    ${n ? `<ul class="import-peek small">${p.fresh.slice(0, 3).map((s) =>
      `<li><b>${esc(s.title)}</b> · ${s.artist ? esc(s.artist) : '<span class="muted">artist unknown</span>'}</li>`).join('')}${n > 3 ? `<li class="muted">and ${n - 3} more</li>` : ''}</ul>
      ${!im.file || detectSource(im.file.text) === 'file' ? `<p class="tiny muted">Song and artist the wrong way round? Switch "Each line is" above.</p>` : ''}` : ''}
    <div class="row between actions">
      <span></span>
      <button class="primary" data-action="import-add" ${n ? '' : 'disabled'}>Add ${n || ''} to Unranked</button>
    </div>`;
}

function updateImport() {
  const im = state.importing;
  const text = im.file ? im.file.text : im.text;
  im.parsed = text.trim() ? sortImport(parseSongs(text, { artistFirst: im.artistFirst }), state.ratings, state.unranked) : null;
  renderImportSummary();
}

function openImport() {
  state.importing = { text: '', file: null, artistFirst: false, parsed: null };
  renderModal();
}

// Rank a song from the Unranked list: search the catalog for it, then the usual rating window.
function rankQueued(item) {
  if (!item) return;
  state.queueItem = item;
  openSearch(searchTermFor(item));
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

function openSearch(term = '') {
  state.search = { term, results: [], active: 0, loading: false, error: null };
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
// Buttons can carry their own words (data-play / data-pause); plain ones show ▶ and ❚❚.
// Cover-art buttons keep their picture and just show a playing state.
const setPlay = (b, on) => { if (b.classList.contains('art-btn')) b.classList.toggle('playing', on); else b.textContent = on ? b.dataset.pause || '❚❚' : b.dataset.play || '▶'; };
const resetPlayButtons = () => document.querySelectorAll('[data-action="preview"]').forEach((b) => setPlay(b, false));
function togglePreview(url, btn) {
  resetPlayButtons();
  if (playingUrl === url && !audio.paused) { audio.pause(); playingUrl = null; return; }
  audio.src = url;
  audio.play().catch(() => toast("Couldn't play the preview"));
  playingUrl = url;
  setPlay(btn, true);
}
audio.addEventListener('ended', () => { playingUrl = null; resetPlayButtons(); });

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
  state.importing = null; state.queueItem = null; state.playlist = null; state.maker = null; state.returnTo = null;
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
    case 'toggle-profile': {
      const p = el.closest('.profile');
      const open = !p.classList.contains('open');
      closeProfileMenus();
      p.classList.toggle('open', open);
      break;
    }
    case 'sign-out': act(async () => {
      await store.signOut();
      Object.assign(state, { uid: null, me: null, ratings: [], history: [], unranked: [], forYou: null, playlist: null, saved: [], maker: null, returnTo: null, comparing: null, view: 'library', leftView: 'library', rightView: 'taste' });
      render();
    }); break;
    case 'view': {
      const v = el.dataset.view;
      state.view = v;
      if (v === 'library' || v === 'unranked') state.leftView = v; else state.rightView = v;
      state.comparing = null; render(); if (v === 'friends') refreshFriends(); break;
    }
    case 'open-search': openSearch(); break;
    case 'close-modal': case 'close-modal-bg': closeModals(); break;
    case 'pick': pickResult(state.search.results[+el.dataset.i]); break;
    case 'edit': openRating(state.ratings.find((r) => r.song_id === id)); break;
    case 'rank-from-friend': openRating(state.comparing.ratings.find((r) => r.song_id === id)); break;
    case 'open-guide': state.guide = true; renderModal(); break;
    case 'close-guide': case 'close-guide-bg': state.guide = false; renderModal(); break;
    case 'manual-add': {
      const q = state.queueItem;
      state.manual = q ? { title: q.title, artist: q.artist } : { title: state.search?.term || '' };
      state.search = null; renderModal(); break;
    }
    case 'manual-back': { const term = state.queueItem ? searchTermFor(state.queueItem) : state.manual?.title || ''; state.manual = null; openSearch(term); break; }
    case 'toggle-stale': state.filters.stale = !state.filters.stale; render(); break;
    case 'set-layout': state.layout = el.dataset.layout; lsSet('songrank-layout', state.layout); render(); break;
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
      // Once a song is ranked it leaves the Unranked list (the one being ranked, plus any same-song match).
      const k = songKey(song);
      const done = state.unranked.filter((u) => u.id === state.queueItem?.id || songKey(u) === k).map((u) => u.id);
      const back = state.returnTo;
      const qid = state.queueItem?.id;
      state.queueItem = null; state.returnTo = null;
      // The new song it came from leaves For you or a Discover list (its name may differ a little from the
      // catalog's); in a saved playlist it stays, now pointing at the ranked song.
      if (back && qid) {
        if (state.forYou?.songs) { state.forYou.songs = state.forYou.songs.filter((x) => x.song_id !== qid); saveForYou(); }
        if (back.kind === 'saved') {
          back.songs = back.songs.map((x) => (x.song_id === qid ? { ...x, song_id: song.song_id, title: song.title, artist: song.artist, artwork_url: song.artwork_url || x.artwork_url } : x));
          store.savePlaylist({ id: back.savedId, name: back.name, kind: back.discover ? 'discover' : 'mine', songs: back.songs, settings: back.settings })
            .then(async () => { state.saved = await store.playlists(); }).catch(() => {});
        } else if (back.kind !== 'foryou') back.songs = back.songs.filter((x) => x.song_id !== qid);
      }
      if (done.length) {
        await store.removeUnranked(done);
        state.unranked = state.unranked.filter((u) => !done.includes(u.id));
      }
      state.ratings = await store.ratingsOf(state.uid);
      state.history = await store.historyOf();
      state.rating = null; audio.pause();
      toast(`Ranked ${song.title}: ${score} · ${tierOf(score).name}`);
      render();
      if (back) { state.playlist = back; renderModal(); }
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
    case 'filter-tag': state.filters = { ...state.filters, tag: el.dataset.tag }; state.view = 'library'; state.leftView = 'library'; render(); break;
    case 'import-open': openImport(); break;
    case 'rail-find': {
      if (state.leftView !== 'library') { state.leftView = 'library'; render(); }
      const box = document.querySelector('.col [data-filter="q"]');
      if (box) { box.scrollIntoView({ block: 'nearest' }); box.focus({ preventScroll: true }); }
      break;
    }
    case 'import-order': state.importing.artistFirst = el.dataset.first === 'artist';
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      updateImport(); break;
    case 'import-clear-file': state.importing.file = null; updateImport(); break;
    case 'import-add': act(async () => {
      const im = state.importing;
      const songs = im?.parsed?.fresh || [];
      if (!songs.length) return;
      el.disabled = true; el.textContent = 'Adding…';
      try {
        await store.addUnranked(songs.map((x) => ({ ...x, source: im.file ? detectSource(im.file.text) : 'paste' })));
        state.unranked = await store.unranked();
      } catch (err) {
        // Some may have gone in already; re-check so trying again only adds the rest.
        try { state.unranked = await store.unranked(); } catch { /* keep what we had */ }
        updateImport();
        throw err;
      }
      closeModals();
      state.view = 'unranked'; state.leftView = 'unranked'; state.filters.uq = ''; state.unShown = 100;
      render();
      toast(`Added ${songs.length} song${songs.length === 1 ? '' : 's'} to Unranked`);
    }); break;
    case 'un-next': rankQueued(state.unranked[0]); break;
    case 'un-rank': rankQueued(state.unranked.find((u) => u.id === id)); break;
    case 'un-skip': act(async () => {
      await store.skipUnranked(id);
      state.unranked = await store.unranked();
      render();
      toast('Moved to the end of the list');
    }); break;
    case 'un-remove': act(async () => {
      await store.removeUnranked([id]);
      state.unranked = state.unranked.filter((u) => u.id !== id);
      render();
    }); break;
    case 'un-clear': act(async () => {
      if (!confirm(`Remove all ${state.unranked.length} songs from your Unranked list? Your ranked songs stay.`)) return;
      await store.clearUnranked();
      state.unranked = [];
      render();
    }); break;
    case 'un-more': state.unShown += 200; render(); break;
    case 'copy-code': copyText(inviteText(), 'Invite copied. Paste it in a text.'); break;
    case 'copy-plain-code': copyText(state.me.friend_code, `Copied your code: ${state.me.friend_code}`); break;
    case 'share-invite': {
      closeProfileMenus();
      const text = inviteText();
      // The phone's share sheet (Messages, etc.); computers without one copy instead.
      if (navigator.share) navigator.share({ title: 'Song Ranker', text }).catch(() => {});
      else copyText(text, 'Invite copied. Paste it in a text.');
      break;
    }
    case 'open-playlist': openPlaylist(el.dataset.id); break;
    case 'close-playlist': state.playlist = null; audio.pause(); renderModal(); break;
    case 'pl-copy': copyText(playlistText(state.playlist), 'Playlist copied as a list'); break;
    case 'pl-download': downloadPlaylist(state.playlist); break;
    case 'pl-share': {
      const text = playlistText(state.playlist);
      if (navigator.share) navigator.share({ title: state.playlist.name, text }).catch(() => {});
      else copyText(text, 'Playlist copied as a list');
      break;
    }
    case 'fy-build': makeForYou(); break;
    case 'fy-rank': {
      const song = plSong(id);
      if (!song) break;
      const pl = state.playlist;
      state.playlist = null; audio.pause();
      state.returnTo = pl;
      state.queueItem = { id: song.song_id, title: song.title, artist: song.artist, from: pl?.kind === 'foryou' || !pl ? 'For you' : pl.name };
      openSearch(searchTermFor(song));
      break;
    }
    case 'fy-save': act(async () => {
      const song = plSong(id);
      if (!song) return;
      if (state.unranked.some((u) => songKey(u) === songKey(song))) { toast(`${song.title} is already on your Unranked list`); return; }
      await store.addUnranked([{ title: song.title, artist: song.artist, album: song.album, source: state.playlist?.discover ? 'discover' : 'for-you' }]);
      state.unranked = await store.unranked();
      dropForYou(id, false);
      toast(`Saved ${song.title} to Unranked`);
    }); break;
    case 'fy-nope': dropForYou(id, true); break;
    case 'maker-open': openMaker(el.dataset.mode); break;
    case 'mk-chip': {
      const { group, val } = el.dataset;
      const m = state.maker;
      if (el.dataset.single) {
        m[group] = val;
        el.closest('.modal').querySelectorAll(`[data-group="${group}"]`).forEach((b) => b.classList.toggle('on', b === el));
      } else {
        m[group] = m[group].includes(val) ? m[group].filter((x) => x !== val) : [...m[group], val];
        el.classList.toggle('on');
      }
      updateMakerCount();
      break;
    }
    case 'mk-set': {
      state.maker[el.dataset.key] = el.dataset.val;
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
      if (el.dataset.key === 'reach') $('#mk-reach').textContent = REACH_HINT[el.dataset.val];
      updateMakerCount();
      break;
    }
    case 'maker-go': act(makerGo); break;
    case 'pl-again': {
      const pl = state.playlist;
      state.playlist = null; audio.pause();
      openMaker(pl.discover ? 'discover' : 'mine');
      break;
    }
    case 'pl-save': act(async () => {
      const pl = state.playlist;
      if (!state.savedOk) throw new Error("Saving playlists needs a quick update to the app's database first.");
      const name = ($('#pl-name')?.value || pl.name).trim() || 'My playlist';
      if (!pl.songs.length) throw new Error('This playlist has no songs left.');
      el.disabled = true;
      const row = await store.savePlaylist({ name, kind: pl.discover ? 'discover' : 'mine', songs: pl.songs, settings: pl.settings });
      state.saved = await store.playlists();
      state.playlist = { id: `s:${row.id}`, savedId: row.id, name: row.name, kind: 'saved', discover: pl.discover, settings: row.settings, songs: row.songs };
      render();
      toast(`Saved "${row.name}"`);
    }); break;
    case 'pl-delete': act(async () => {
      const pl = state.playlist;
      if (!confirm(`Delete the playlist "${pl.name}"? The songs stay ranked.`)) return;
      await store.deletePlaylist(pl.savedId);
      state.saved = await store.playlists();
      state.playlist = null; audio.pause();
      render();
      toast('Playlist deleted');
    }); break;
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

let importTimer;
// Choosing a file in the Import window.
document.addEventListener('change', (e) => {
  if ((e.target.id === 'mk-min' || e.target.id === 'mk-max') && state.maker) {
    state.maker[e.target.id === 'mk-min' ? 'min' : 'max'] = +e.target.value;
    updateMakerCount();
    return;
  }
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  const file = e.target.files[0];
  act(async () => {
    if (file.size > 20e6) throw new Error('That file is too big (over 20 MB).');
    const text = await readFileText(file);
    if (!state.importing) return;
    state.importing.file = { name: file.name, text };
    updateImport();
  });
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'search-input') onSearchInput(t.value);
  else if (t.id === 'pl-name' && state.playlist) state.playlist.name = t.value;
  else if (t.id === 'import-text') {
    state.importing.text = t.value;
    clearTimeout(importTimer);
    importTimer = setTimeout(() => { if (state.importing && !state.importing.file) updateImport(); }, 250);
  }
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
    const f = t.dataset.filter;
    state.filters[f] = t.value;
    if (f === 'uq') state.unShown = 100;
    const pos = t.selectionStart;
    render();
    if (f === 'q' || f === 'uq') { const el = $(`[data-filter="${f}"]`); el.focus({ preventScroll: true }); el.setSelectionRange(pos, pos); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.profile.open')) { closeProfileMenus(); return; }
    if (state.guide) { state.guide = false; renderModal(); return; }
    if (state.search || state.rating || state.manual || state.importing || state.playlist || state.maker) { closeModals(); return; }
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
        await claimInvite();
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
