# Example input files

These samples show the exact CSV shapes the extension expects, so you can
sanity-check your own Google Takeout export before running a migration. All
IDs below are public, well-known channels/videos — no personal data.

```
examples/
├── subscriptions.csv          # feed this to the "Subscriptions" section
└── playlists/                 # pick this folder in the "Playlists" section
    ├── My Favorites-videos.csv
    └── Coding Tutorials-videos.csv
```

## subscriptions.csv

Comes from Google Takeout at
`YouTube and YouTube Music/subscriptions/subscriptions.csv`.

```csv
Channel Id,Channel Url,Channel Title
UC_x5XG1OV2P6uZZ5FSM9Ttw,http://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw,Google for Developers
```

- A header row is required (the extension skips the first row).
- Only **column 2 (Channel Url)** and **column 3 (Channel Title)** are used.

## playlists/

Comes from Google Takeout at `YouTube and YouTube Music/playlists/`. In the
extension, choose the **folder**, not individual files.

- One file per playlist, named `<Playlist title>-videos.csv`. The playlist
  name is taken from the filename with `-videos.csv` removed.
- A header row is required (the extension skips the first row).
- Only **column 1 (Video ID)** is used; the timestamp column is ignored.

```csv
Video ID,Playlist video creation timestamp
dQw4w9WgXcQ,2024-01-15T10:30:00+00:00
```

> **Note on `/` in playlist names:** Takeout replaces filesystem-illegal
> characters (`/ \ : * ? " < > |`) with `_` in the filename. A playlist
> titled `CS 194/294-196` is exported as `CS 194_294-196-videos.csv`. The
> extension normalizes this when matching, so the videos still land in the
> right playlist.

The header labels themselves don't matter (the extension parses by column
position), but keeping Takeout's original headers is the safest choice.
