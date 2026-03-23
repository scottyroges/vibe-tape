# Spotify Dev-Mode API Restrictions

**Discovered:** 2026-03-22

## What's restricted

Spotify restricts certain data for apps in **development mode** (i.e., apps that haven't been approved for extended quota access):

- **`GET /v1/artists?ids=` (batch endpoint):** Returns `403 Forbidden` entirely.
- **`GET /v1/artists/{id}` (single endpoint):** Returns a simplified object — no `genres` field.
- **`GET /v1/me/tracks` (liked songs):** `track.popularity` returns `undefined`. `duration_ms` and `release_date` still work.

## Impact on Vibe Tape

- **Artist genres from Spotify are unavailable.** The `enrich-artists/spotify-genres` step has been skipped in `sync-library`. Artist genre data will come from Last.fm tags instead.
- **Track popularity is null** in `TrackSpotifyEnrichment`. The field is still populated during sync (from the API response), but Spotify returns `undefined` so it stores as `null`.
- **Duration and release date are unaffected.**

## How to get extended quota access

1. Go to **developer.spotify.com/dashboard** → select the app
2. Click **Request Extension** (or "Submit for Review")
3. Fill out the form: app description, endpoints needed, screenshots, privacy policy URL
4. Spotify reviews (typically 2-6 weeks)

Requirements:
- A working app they can test
- A privacy policy page
- Clear description of why you need the data
- Compliance with Spotify developer terms

For Vibe Tape's use case (reading liked songs + artist metadata for playlist generation), approval should be straightforward. Request access to the **Web API** extended quota for artist details and track popularity.

## When to revisit

Once extended quota is approved:
- Re-enable the `enrich-artists/spotify-genres` step in `sync-library`
- Track popularity will start populating automatically (no code change needed)
