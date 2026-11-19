# 🎵 Song Ranker

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

**2. GitHub (the web address)**
1. Make a free account at github.com and a new repository called `song-ranker`.
2. Upload this folder to it (Claude can do this step with you).
3. In the repository: **Settings → Pages → Deploy from a branch → main → / (root) → Save**.
   After a minute your app is at `https://<your-username>.github.io/song-ranker/`.

**3. Connect them**
In Supabase: **Authentication → URL Configuration**. Set **Site URL** to your GitHub Pages address
so the "confirm your email" links point back to the app.

## Inviting friends

Open **Friends → Copy invite** and text the invite to a friend. They make an account at the same web
address and type your code. You accept their request, and then **Compare** shows:
- how often you agree on songs you've both ranked,
- **Discover:** songs they love that you haven't ranked, with a preview to play,
- your favorites they haven't ranked yet.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page and how it looks |
| `js/app.js` | Screens and buttons |
| `js/itunes.js` | Song search |
| `js/stats.js` | Favorite decade/genre math and friend comparisons |
| `js/store.js` | Saving: practice mode or Supabase |
| `supabase/setup.sql` | Database tables and who-can-see-what rules |
| `config.js` | Your Supabase address and public key |
