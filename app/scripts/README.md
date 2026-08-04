# Build Scripts

Runbook for building and deploying `shellbros.github.io`. For repo-level context
(what this repo is, what not to hand-edit) see `../../CLAUDE.md`.

## TL;DR

```bash
bash app/scripts/build.sh     # 6 steps, 2 local commits, no push
git push origin main          # deploy
python3 app/scripts/purge.py  # purge jsDelivr — required, see "Why purge"
```

Answer `1` (No) at "Do items need to be vaulted?" and enter your sudo password.
Run it from a real terminal; see "Sudo and tty" below.

## Prerequisites

| Requirement | Why | Check |
|---|---|---|
| `python3`, `node`, `git` | `build.sh` validates these up front | `build.sh` step 0 |
| Fresh compiled client | Prevents shipping a stale bundle | `build.sh` hard-fails if stale |
| nginx + php-fpm on `localhost` | `index.html` is curled from `index.php` | `curl -u eggs:thatwasntandy localhost/index.php` |
| Real terminal (tty) | sudo password + interactive compile prompt | `tty` |

Compile the client first if the guard complains:

```bash
cd ../ShellShockers/game
sudo ./compile.sh live compress    # answer 1 = No at the vault prompt
```

## Pipeline

`build.sh` runs these in order and stops on any error (`set -e`).

| # | Step | Script | Effect |
|---|---|---|---|
| 0 | Guard | `build.sh` | Verifies deps, and that `home/js/shellshock.js` is newer than all of `game/src/` |
| 1 | Sync | `sync.py` | Runs `makeShellHome.sh`, wipes this repo (minus whitelist), copies `distShellHome` in, empties `distShellHome` |
| 2 | Allowlist | `update-proxy-list.sh` | Regenerates the `allowlist` array in `functions/_shared/wsProxy.js` from `root_domains.json` |
| 3 | CDN rewrite | `makeShell.sh <sha>` | Injects `window.JSCDN` + `checker.js`, strips meta/title/ld+json, rewrites asset paths via `cdnSearchReplace.js`, patches known Loader bugs |
| 4 | Commit | `build.sh` | `BUILD shell YYYY-MM-DD` |
| 5 | Version | `update-build.py` | Writes the new sha to `build.json`, increments `build_number` |
| 6 | Commit | `build.sh` | `UPDATE build YYYY-MM-DD` |

Two commits are required because step 3 needs a sha that does not exist until step 4
creates it. Step 5 exists to close that gap.

## Scripts

### `build.sh`
Entry point. Path-independent. Never pushes.

### `sync.py`
Destructive. Deletes everything in the repo root except
`.git .gitignore app/ readme.md functions/ _headers`, then copies
`../ShellShockers/game/distShellHome/` in and empties it.

Aborts before deleting anything if the source is missing or empty, so a failed
upstream build cannot wipe the repo.

```bash
python3 sync.py --dry-run              # preview
python3 sync.py --url staging.shellshock.io   # default: localhost
```

Step 0 of `sync.py` shells out to `../ShellShockers/game/makeShellhome.sh`, which
compiles the client, curls `index.php`, and rsyncs into `distShellHome`.

### `update-proxy-list.sh`
Syncs domains from `root_domains.json` into the `allowlist` array in
`functions/_shared/wsProxy.js`. Writes a gitignored `.backup` alongside it.
Do not hand-edit that array — it is regenerated every build.

### `makeShell.sh <short-sha>`
Prepares `index.html` for CDN delivery. Run from this directory (`build.sh` cds for
you). Also patches three bugs that ship from `distShellHome`: `j.sha` →
`j.build_version`, `Loader.cdnurl` → `Loader.cdnUrl`, and a bogus `build.json`
`<script src>`.

### `update-build.py`
Writes the current sha into `build.json` and increments `build_number`.
Supports `--dry-run`.

> **Known bug.** Its regex targets `shellbros/mathlete@…` (leftover from the sibling
> `mathlete` repo), so in this repo it matches nothing and never rewrites `index.html`.
> Asset URLs stay pinned to the previous build's sha. See `../../CLAUDE.md`, gotcha 1.

### `purge.py`
Purges jsDelivr for `build.json`, `checker.js`, and `index.html`. Run **after** push.

### `cdnSearchReplace.js`
Called by `makeShell.sh`. Rewrites relative asset paths to CDN URLs.

## Why purge

Asset URLs are sha-pinned and immutable, so they never need purging. But the client
learns which sha to use by fetching **unversioned** `app/build.json`, and jsDelivr
serves that with `max-age=604800, s-maxage=43200` — 12 hours at the edge, 7 days in
the browser. Skip the purge and players keep loading the old build.

`purge.py` clears the **edge** only. Browsers that already cached `build.json` can
stay on the old sha for up to 7 days regardless. The `{ cache: 'no-store' }` on the
`build.json` fetch in `index.html` is what avoids that — don't remove it.

## Sudo and tty

`makeShellHome.sh` starts with `sudo ./compile.sh live compress`, and `compile.sh live`
opens an interactive `select` prompt. Both need a tty.

`makeShellHome.sh` has **no `set -e`**, so when sudo fails it prints an error and
continues, reusing whatever bundle is already in `home/js/`. The freshness guard in
`build.sh` keeps that from shipping stale code, but the build is then missing its fresh
anti-cheat obfuscation pass.

**Always grep the output for `sudo: a password is required` before trusting a build.**

This is why agents and CI cannot run the build unattended.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `compiled client is STALE` | Sources newer than the bundle | `cd ../ShellShockers/game && sudo ./compile.sh live compress` |
| `sudo: a password is required` in step 1 | No tty | Run from Terminal.app |
| `Source directory is empty` | `makeShellHome.sh` produced nothing | Check that `localhost/index.php` returns 200 |
| Empty or tiny `index.html` | curl to `localhost/index.php` failed | Verify nginx + php-fpm are running |
| `No CDN URLs found in index.html` | The `mathlete` regex bug | Expected until fixed; see gotcha 1 |
| Players still on the old build after push | jsDelivr cache | `python3 app/scripts/purge.py` |
| `No changes to commit` | Build was byte-identical | Normal if nothing changed upstream |
