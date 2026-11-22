// Turns a pasted list or an uploaded file into songs for the Unranked list.
// Pure functions: no browser needed, and nothing is looked up in a catalog here,
// so even a library of thousands of songs imports instantly.
import { songKey } from './stats.js?v=15';

// Reads an uploaded file as text. Apple's Music app saves its exports as UTF-16,
// which a plain text read would garble, so check the first bytes.
export async function readFileText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let enc = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) enc = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) enc = 'utf-16be';
  else if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) enc = 'utf-16le'; // no marker, but every other byte is empty
  return new TextDecoder(enc).decode(bytes).replace(/^﻿/, '');
}

// Column names used by music apps and transfer sites, most specific first.
const TITLE_COLS = ['track name', 'song title', 'track title', 'song name', 'title', 'name', 'song', 'track'];
const ARTIST_COLS = ['artist name(s)', 'artist names', 'artist name', 'artist name 1', 'artists', 'artist', 'album artist'];
const ALBUM_COLS = ['album name', 'album title', 'album'];

const norm = (s) => s.trim().replace(/^"|"$/g, '').trim().toLowerCase();

function findCol(header, names) {
  for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
  return -1;
}

// Splits delimited text (CSV, tab-separated) into rows, handling "quoted, values".
// Tab-separated files (Apple's) don't use quotes, so a title like "Heroes" is kept as is.
export function splitRows(text, delim) {
  const quotes = delim !== '\t';
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (quotes && c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// A spreadsheet-style file: its first line names the columns. Returns null when it isn't one.
function parseTable(text) {
  const first = text.split(/\r\n|\r|\n/, 1)[0];
  const delim = ['\t', ',', ';'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0];
  if (delim[1] < 2) return null;
  const header = splitRows(first, delim[0])[0].map(norm);
  const t = findCol(header, TITLE_COLS);
  // A spreadsheet with no title column, like Takeout's playlist files (just video codes and dates):
  // nothing to import, rather than treating each line as a song name.
  if (t < 0) return header.some((h) => /\b(id|uri|timestamp|isrc)\b/.test(h)) ? [] : null;
  const a = findCol(header, ARTIST_COLS);
  const al = findCol(header, ALBUM_COLS);
  return splitRows(text, delim[0]).slice(1).map((r) => ({
    title: (r[t] || '').trim(),
    artist: a >= 0 ? (r[a] || '').trim().replace(/,(?=\S)/g, ', ') : '', // "Queen,David Bowie" -> "Queen, David Bowie"
    album: al >= 0 ? (r[al] || '').trim() : '',
  }));
}

// One song per line: "Song – Artist" (or "Artist – Song" when artistFirst).
function parseLines(text, artistFirst) {
  return text.split(/\r\n|\r|\n/).map((raw) => {
    let line = raw.trim().replace(/^\d{1,4}[.)]\s+/, '').replace(/^[-*•]\s+/, ''); // "12. " or "• " list markers
    if (!line) return null;
    if (line.includes('\t')) { const [x, y] = line.split('\t'); line = `${x} – ${y}`; }
    // Dashes with spaces around them separate title and artist. Prefer a long dash (– —),
    // since titles often contain " - " ("Song - 2011 Remaster").
    let parts = line.split(/\s+[–—]\s+/);
    if (parts.length < 2) parts = line.split(/\s+-\s+/);
    if (parts.length < 2 && !artistFirst) {
      const m = line.match(/^(.+?)\s+by\s+(.+)$/i);
      if (m) parts = [m[1], m[2]];
    }
    if (parts.length < 2) return { title: line, artist: '', album: '' };
    // Artist first: the artist is the first part. Song first: the artist is the last part.
    return artistFirst
      ? { artist: parts[0], title: parts.slice(1).join(' - '), album: '' }
      : { title: parts.slice(0, -1).join(' - '), artist: parts[parts.length - 1], album: '' };
  }).filter(Boolean);
}

// Reads the songs out of text. artistFirst only matters for plain one-per-line lists.
export function parseSongs(text, { artistFirst = false } = {}) {
  const clean = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 200);
  const rows = parseTable(text) || parseLines(text, artistFirst);
  return rows
    .map((r) => ({ title: clean(r.title), artist: clean(r.artist), album: clean(r.album) || null }))
    .filter((r) => r.title);
}

// Which app a file came from, from its column names (kept with each song as its "source").
export function detectSource(text) {
  const h = text.split(/\r\n|\r|\n/, 1)[0].toLowerCase();
  if (h.includes('artist name(s)') || h.includes('track uri')) return 'spotify';
  if (h.includes('video id') || h.includes('artist name 1')) return 'youtube-music';
  if (h.includes('\t') && /\bname\b/.test(h) && h.includes('composer')) return 'apple-music';
  if (h.includes('playlist name')) return 'transfer-site';
  return 'file';
}

// Sorts parsed songs into new ones, ones already ranked, and ones already waiting or repeated.
export function sortImport(songs, ranked, waiting) {
  const rankedKeys = new Set(ranked.map(songKey));
  const seen = new Set(waiting.map(songKey));
  const out = { fresh: [], ranked: 0, repeats: 0 };
  for (const s of songs) {
    const k = songKey(s);
    if (rankedKeys.has(k)) out.ranked++;
    else if (seen.has(k)) out.repeats++;
    else { seen.add(k); out.fresh.push(s); }
  }
  return out;
}

// A catalog search for an unranked song: its title plus its main artist, without
// "(feat. …)" or " - Remastered" parts that make search miss.
export function searchTermFor(s) {
  const title = s.title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() || s.title;
  const artist = (s.artist || '').split(/\s*(?:,|;|&|\bfeat\.?|\bft\.?|\bwith\b)\s*/i)[0].trim();
  return `${title} ${artist}`.trim();
}
