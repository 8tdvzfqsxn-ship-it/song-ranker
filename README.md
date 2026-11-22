# Song Ranker

Rank songs from 1 to 100, tag them for moments (nighttime driving, shower songs, cooking),
see which decade and genre you love most, and link with friends to compare and find new music.

- **Song search:** Apple's free iTunes catalog. It suggests titles as you type and gives each
  song's year, genre, artwork and a 30-second preview.
- **Accounts and rankings:** [Supabase](https://supabase.com), a free service that handles sign-in
  and stores the data. Its rules (in `supabase/setup.sql`) mean only you and the friends you've
  accepted can see your rankings.
- **The page itself:** GitHub Pages, free hosting for a GitHub repository.

## Try it on your Mac (practice mode)

```bash
node tools/serve.mjs
```

Then open http://localhost:5173. With `config.js` left blank, everything is saved only in that
browser. Add the friend code **SAM123** to get a practice friend to compare with.

## Go live (about 20 minutes, once)

**1. Supabase (the sign-ins and the database)**
1. Make a free account at supabase.com and create a new project. Write the database password
   somewhere safe; the app doesn't need it.
2. In the project, open **SQL Editor → New query**, paste all of `supabase/setup.sql`, and press **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into
   `config.js`. (Never copy the `service_role` key anywhere.)

4. **Backup song search** (for phones or networks that block Apple's catalog): open
   **Edge Functions → Deploy a new function → Via Editor**, name it `song-search`, paste
   `supabase/functions/song-search/index.ts`, deploy, then in its **Settings** turn
   **Verify JWT with legacy secret** off (the code checks sign-in itself) and save.

**2. GitHub (the web address)**
1. Make a free account at github.com and a new repository called `song-ranker`.
2. Upload this folder to it (Claude can do this step with you).
3. In the repository: **Settings → Pages → Deploy from a branch → main → / (root) → Save**.
   After a minute your app is at `https://<your-username>.github.io/song-ranker/`.

**3. Connect them**
In Supabase: **Authentication → URL Configuration**. Set **Site URL** to your GitHub Pages address
so the "confirm your email" links point back to the app.

## Inviting friends

Open **Friends → Share invite** and send it to a friend. When they open the link and make an account,
the friend request comes to you automatically (they can also type your code). You accept their request, and then **Compare** shows:
- how often you agree on songs you've both ranked,
- **Discover:** songs they love that you haven't ranked, with a preview to play,
- your favorites they haven't ranked yet.

## Bringing in your music library

**Unranked → Import songs** takes a pasted list ("Song – Artist", one per line) or a file: Spotify through
the free site exportify.net, Apple Music on a Mac (File → Library → Export Playlist), YouTube Music through
Google Takeout (`music library songs.csv`), or any app through a free transfer site like TuneMyMusic.
Songs wait in the Unranked list; **Rank** finds each one in the catalog when you get to it.

## Finding new music

**My taste → Playlists → For you** suggests new songs similar to the ones you score 80 and up, using
Deezer's free catalog (artists related to your favorites, and their top songs). Every playlist, including
For you, can be downloaded as a file; the free site TuneMyMusic turns it into a YouTube Music (or any app)
playlist.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page and how it looks |
| `js/app.js` | Screens and buttons |
| `js/itunes.js` | Song search |
| `js/stats.js` | Favorite decade/genre math and friend comparisons |
| `js/importer.js` | Reads pasted lists and music-app files for the Unranked list |
| `js/recommend.js` | "For you" suggestions from Deezer's free catalog |
| `js/store.js` | Saving: practice mode or Supabase |
| `supabase/setup.sql` | Database tables and who-can-see-what rules |
| `config.js` | Your Supabase address and public key |
