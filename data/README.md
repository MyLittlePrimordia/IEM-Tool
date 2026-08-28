# data/

This folder holds the raw measurement `.txt` files referenced by
`database.json` (each catalog entry's `"files"` array points here, e.g.
`"data/HANGOUT.AUDIO/64 AUDIO V2 (1964 EARS) V2.txt"`).

It's intentionally not bundled with the app's own source — it's meant to be
kept in sync from a separate, more-frequently-updated database repo. To
update the catalog:

1. Overwrite `database.json` / `database.json.gz` (repo root) and this
   `data/` folder with the latest versions from that repo.
2. Relaunch the app (Electron) or refresh the page (web/GitHub Pages) — no
   reinstall needed.

In the packaged Electron app, this folder and the two `database.json*`
files live in `resources/` next to `app.asar`, specifically so they stay
writable/replaceable after install (see `getDataRoot()` in `main.js`).
