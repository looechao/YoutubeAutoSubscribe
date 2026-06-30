# Mock Takeout files

Use these files when testing the extension import flow without using a real
Google Takeout export.

## Subscriptions

Choose this file in the extension's subscriptions section:

```text
mock/subscriptions.csv
```

## Playlists

Choose this folder in the extension's playlists section:

```text
mock/playlists/
```

The `CS 194_294-196-videos.csv` file intentionally uses `_` in the filename.
This mocks Google Takeout's behavior for a playlist whose real YouTube title is
`CS 194/294-196`.

The mock playlist folder contains three playlists, each with three videos. This
is intentional: it exercises the extension's nested playlist/video loop instead
of only testing a single short playlist.
