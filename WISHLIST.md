# Song Ranker wishlist

Changes Josh wants **later**. Nothing here gets built until Josh says to build it, and then only the items
he names. When an item is built, move it to "Done" with the date.

## Waiting

*Nothing waiting right now.*

## Done

**Built 2026-11-22 (v14):**
- #6 Share my friend code: **Share invite** opens the phone's share sheet; the code in the profile menu copies with a tap.
- #7 Invite links: the invite is a link with the friend code in it. A friend who opens it and makes an account
  (or signs in) sends the friend request automatically, even after confirming their email.
- #9 Playlists from my rankings: My taste → **Playlists** (90+, 80+, each moment tag, best of each decade, top
  of each genre). Each one can be downloaded as a file, copied, or shared; the free site TuneMyMusic turns the
  file into a YouTube Music (or any app) playlist. Direct Spotify/Apple playlist creation not built (limits/cost).
- #10 Preview button: now a full-width "▶ Play preview" under the song, away from the Duo's clock and icons.
- #11 For you: new songs from artists related to the ones behind your 80+ songs (Deezer, no account), scored by
  how many favorites point to them, with previews and Rank / Save for later / Not for me. Your scores and
  "Not for me" steer the next set. "Not for me" is remembered on that device only. Last.fm (free key) can be
  added later for better matches.

**Built 2026-11-22 (v13):**
- #8 Music library to an "Unranked" list: **Unranked** tab with Rank the next one / Rank / Skip / Remove,
  and an **Import songs** window (paste a list, or a file from Exportify for Spotify, Apple Music on a Mac,
  Google Takeout for YouTube Music, or a transfer site like TuneMyMusic), with a short guide for each.
  Songs already ranked are left out; ranking a song takes it off the list. Tested with Josh's real
  YouTube Music library file (59 songs: 46 added, 13 already ranked). Takeout only includes songs saved to
  the library, not likes or playlists; a transfer site covers those. The iPhone Apple Music Shortcut was set
  aside, since Josh uses YouTube Music. Spotify direct connection not built (free mode only works for a few
  hand-added people).

**Built 2026-11-20 (v5):**
- #1 Who's who: initials icons next to every score, a "You · Name" key in Compare.
- #2 More songs: Deezer (then MusicBrainz) results added under Apple's, plus "Add it yourself".
- #3 "What song is this?": dropped 2026-11-20 to keep the app free; the search window points to Shazam instead.
- #4 Ranking dates and taste over time: every score is kept with its date, "Ranked on…" on each song,
  a nudge after 6 months, and a "Taste over time" card on My taste.
- #5 How to rank: guide page, live tier name on the slider, new songs start at 50.

<details><summary>The original requests</summary>
### 6. Share my friend code easily
*Asked 2026-11-21.* Copy my code and send it to others.
- **Today:** Friends → "Copy invite" copies a link plus the code; the code also shows in the profile menu.
- **Idea:** a **Share** button that opens the phone's share sheet (Messages, etc.) with the invite ready,
  and a tap-to-copy on the code in the profile menu. Free.

### 7. Invite people so they make their own login
*Asked 2026-11-21.*
- **Idea:** a personal invite link (the app's address plus my code). A friend opens it, creates their own
  account, and the friend request to me is sent automatically. No typing codes. Free.

### 9. Make playlists from my rankings and send them to my music app
*Asked 2026-11-21.* Song Ranker builds playlists from my rankings (for example "My 90+ songs",
"Nighttime driving", "Best of the 80s") and exports them to my streaming app.
- **Free ways:** create the playlist directly in **Spotify** (same free-mode limit as above); an
  **Apple Shortcut** that searches Apple Music and adds the songs to a new playlist; or a downloadable
  list for a free transfer site to load into any service.
- **Not free:** creating Apple Music playlists from inside the app ($99/year developer membership).
- **Depends on:** #8 (built 2026-11-22). Josh listens on YouTube Music.

### 10. Preview button hidden on the Duo's front screen
*Asked 2026-11-22.* In the rating window, the ▶ preview button sits in the top-right corner, where the
phone's clock and Wi-Fi icons cover it on the iPhone Duo's front (folded) screen, so it can't be tapped.
- **Idea:** move the play button out of that corner (for example a "▶ Play preview" button under the song
  name), and start the window a little lower so nothing sits under the clock and icons. Free.

### 11. "For you" playlists: real recommendations from the songs I love (one of the main reasons for the app)
*Asked 2026-11-22.* The app learns which songs a person really loves and builds a playlist of new songs that
are actually similar to their favorites, because the music apps' recommendations are bad.
- **How it could work (free):**
  1. **Seeds:** your 80+ songs, with the highest and most recent scores counting most.
  2. **Find similar songs** for each seed from free music databases:
     - **Deezer** (no account needed, already used for search): artists related to yours, and their top songs.
     - **Last.fm** (free account and key, which Josh would set up himself): "similar tracks", based on
       what millions of listeners play together. Likely the best quality.
     - Spotify and Apple Music can't be used: Spotify turned off recommendations for new apps, and Apple
       needs the $99/year membership.
  3. **Score the candidates:** a song suggested by several of your favorites ranks higher. Leave out songs
     you've already ranked or have waiting, artists you score low, and too many songs by one artist.
  4. **Show a "For you" playlist** with 30-second previews and Rank / Not for me buttons. What you rank
     teaches it: low scores push that direction down, high scores become new seeds.
  5. **Later:** mood playlists from your tags ("Nighttime driving" picks), friends' favorites mixed in, and
     sending the playlist to YouTube Music or other apps (#9).
- **To decide:** start with Deezer only (nothing to set up), or set up a free Last.fm key from the start.
- **Depends on:** enough 80+ songs to learn from; #8's Unranked list helps get there.

### 8. Bring in my music library as an "Unranked" list (the big one)
*Asked 2026-11-21.* Export the songs from my music app into Song Ranker, where they wait in an
"Unranked songs" queue, so it's easy to rank all my music.
- **In the app:** a new Unranked list, with "rank next", skip and remove; ranking a song moves it out.
- **Ways to bring songs in, all free:**
  - **Upload a file or paste a list** (works for every music app). Apple Music on a Mac can export a
    playlist as a text file; YouTube Music's library comes from Google Takeout; free transfer sites
    (like TuneMyMusic) can export any service as a spreadsheet file.
  - **Connect Spotify** directly. Its developer access is free, but apps in its free mode only work for a
    small number of people you add by hand.
  - **Apple Music on iPhone** through an Apple Shortcut that collects the library and sends it to the app.
  - **Not free:** a direct Apple Music connection inside the app needs Apple's developer membership
    ($99/year). YouTube Music has no official way to read your library.
- **To decide:** which music app(s) to support first.

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
