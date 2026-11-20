# Song Ranker wishlist

Changes Josh wants **later**. Nothing here gets built until Josh says to build it, and then only the items
he names. When an item is built, move it to "Done" with the date.

## Waiting

*(none right now)*

## Done

**Built 2026-11-20 (v5):**
- #1 Who's who: initials icons next to every score, a "You · Name" key in Compare.
- #2 More songs: Deezer (then MusicBrainz) results added under Apple's, plus "Add it yourself".
- #3 "What song is this?": dropped 2026-11-20 to keep the app free; the search window points to Shazam instead.
- #4 Ranking dates and taste over time: every score is kept with its date, "Ranked on…" on each song,
  a nudge after 6 months, and a "Taste over time" card on My taste.
- #5 How to rank: guide page, live tier name on the slider, new songs start at 50.

<details><summary>The original requests</summary>
### 1. Show who's who when comparing scores
*Asked 2026-11-19.* In **Compare**, each song shows two scores side by side with nothing saying which is mine
and which is my friend's. Put a picture or icon above or next to each score.
- **Note:** the simplest version is a colored circle with each person's initials, and it needs no setup.
  Real profile photos would need photo uploads (Supabase has free storage for this), a bit more work.
  Either way, add a small "You · Name" label above the score columns.

### 2. Find more songs
*Asked 2026-11-19.* Some songs I listen to (on YouTube Music) don't show up in search.
- **Why:** search uses Apple's catalog. YouTube Music also has covers, remixes, live versions, and
  uploads that never made it to Apple.
- **Options to decide between:**
  - **Add a second free catalog,** like Deezer or MusicBrainz, searched when Apple has no match. No accounts.
  - **Search YouTube itself.** Needs a Google developer account and key, with a daily search limit.
  - **"Add it myself":** type in the title and artist (and year/genre if I know them) when nothing matches.
  Probably a free catalog plus "add it myself" first.

### 3. "What song is this?" (listen and identify)
*Asked 2026-11-19.* A button that listens to what's playing around me, figures out the song, and opens it
ready to rank.
- **How it'd work:** the phone records about 10 seconds (it asks for microphone permission). A
  song-recognition service identifies it, then the app finds it in the catalog.
- **To decide:** the services that do this (AudD, ACRCloud) need an account. They have small free tiers and
  charge beyond that. I'd set up the account and key myself. The sound clip goes to that company, so it's
  only sent when I tap the button.
- **Free stopgap:** the iPhone's built-in Shazam (Control Center) can identify the song, then I type it in.

### 4. Remember when I ranked each song and see my taste change
*Asked 2026-11-19.* Show the date I ranked each song, so I can re-rank it after a while and see how my taste
has changed over time.
- **Today:** the app saves the date of the latest ranking but doesn't show it, and re-ranking overwrites
  the old score.
- **Change:** keep every score with its date (a ranking history), show "ranked on …" on each song, and
  nudge me to re-rank songs I haven't touched in a long time. Add a "my taste over time" view showing which
  songs went up or down, and how my favorite decade and genre shifted. My 6+ current rankings become the
  first entries in the history.

### 5. A "How to rank" guide so everyone scores the same way
*Asked 2026-11-20.* A page explaining what each score means: where songs should land in steps of 10 and why
(for example, why a song you'd happily play every time is a 70). Then everyone using the app means the same
thing by a score, and comparing with friends is fair.
- **Ideas to go with it:**
  - show the tier's name live as you slide the score (slide to 84 and it says "Love it")
  - a "How to rank" link on the rating screen
  - optionally, my own example song for each tier, once I've ranked enough
- **To decide:** the tier wording. Draft to react to (change anything):

  | Score | Tier | What it means |
  | --- | --- | --- |
  | 95–100 | All-time | One of the best songs I've ever heard; never skip, ever |
  | 90–94 | Essential | A top favorite; I'd put it on any playlist |
  | 80–89 | Love it | I seek it out and play it on repeat for a while |
  | 70–79 | Really like it | Always glad when it comes on; would add it to a playlist |
  | 60–69 | Like it | Good song; I don't skip it, but I don't seek it out |
  | 50–59 | It's fine | Background music; neutral |
  | 40–49 | Meh | I'd probably skip it |
  | 20–39 | Not for me | I skip it every time |
  | 1–19 | Can't stand it | I'd turn it off |

  **Decided 2026-11-20:** the slider starts at 50 (the middle) instead of 70, so people move it on purpose.
  Re-ranking a song still starts at its current score.
</details>
