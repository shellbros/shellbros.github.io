# CLAUDE.md — shellbros.github.io

## Read this first

**Ignore `/opt/homebrew/CLAUDE.md` and `/opt/homebrew/AGENTS.md`.** This repo happens to
live under `/opt/homebrew/var/www/`, so Claude Code auto-loads Homebrew/brew's agent
instructions. They are for a different project. There is no `./bin/brew`, no Sorbet,
no RuboCop, and no RSpec here.

## What this repo is

A **build artifact**, not a source repo. It is the public delivery target for the
Shell Shockers web client, serving two roles at once:

| Role | Consumer |
|---|---|
| jsDelivr CDN origin | `cdn.jsdelivr.net/gh/shellbros/shellbros.github.io@<sha>/` |
| Cloudflare Pages site | `shellbros.pages.dev` — incl. the `/matchmaker` WebSocket proxy |

Source lives in the **sibling repo** `../ShellShockers/`. Almost everything here is
generated and overwritten on each build.

## Do not hand-edit

The sync step **deletes the entire repo** except a whitelist, then copies the fresh
build in. Anything you edit outside the whitelist is destroyed on the next build.

Whitelist (`app/scripts/sync.py`, `WHITELIST`):

```
.git   .gitignore   app/   readme.md   functions/   _headers
```

Edit source in `../ShellShockers/game/` instead. `app/checker.js`, the Cloudflare
Functions in `functions/`, and this file are the exceptions — they live here.

## Build

```bash
bash app/scripts/build.sh
```

Path-independent; every script resolves its own location. Ends with two local commits
(`BUILD shell <date>`, `UPDATE build <date>`). **It never pushes.**

Preconditions — the build fails or silently degrades without these:

1. **A compiled client.** `../ShellShockers/game/home/js/shellshock.js` must exist and
   be newer than every file in `game/src/`. `build.sh` hard-fails if not. Compile with:
   `cd ../ShellShockers/game && sudo ./compile.sh live compress` (answer `1` = No at the
   vault prompt).
1b. **Upstream on the right branch.** `../ShellShockers` must be on `portalBranch`.
   `makeShellHome.sh` differs per branch — it hardcodes the CDN base it injects and the
   asset rewriter it runs. Override for a one-off:
   `EXPECTED_BRANCH_OVERRIDE=<branch> bash app/scripts/build.sh`.
2. **A real terminal.** `makeShellHome.sh` runs `sudo`, and `compile.sh live` has an
   interactive prompt. Both need a tty — see the sudo gotcha below.
3. **nginx + php-fpm serving `localhost/index.php`.** The build curls it (basic auth
   `eggs:thatwasntandy`) to produce `index.html`.

Deploy is manual and separate:

```bash
git push origin main
python3 app/scripts/purge.py    # purge jsDelivr for build.json, checker.js, index.html
```

## How versioning works

Each build pins assets to a git sha, so a push alone is not enough — jsDelivr caches
the unversioned `app/build.json`, which is what tells the client which sha to load.

1. `makeShell.sh` rewrites asset URLs in `index.html` to `...@<HEAD-sha>/`.
2. The `BUILD shell` commit creates a **new** sha.
3. `update-build.py` writes that new sha into `app/build.json` and *should* rewrite the
   URLs in `index.html` to match.
4. At runtime `Loader.getBuildSha()` (`index.html`) fetches `build.json` and re-pins
   anything routed through `Loader.cdnUrl()` / `Loader.loadJS()`.

Only assets going through `Loader` get re-pinned at runtime. Plain `<img src>`,
`<link rel=stylesheet>`, `<script src>`, `import()` and `fetch()` URLs use whatever
sha is baked into `index.html`. See gotcha 1.

## Guards in `build.sh`

Both known failure modes were silent — success reported, two commits made, shipped.
So the pipeline validates its **output**, not just its inputs.

| Guard | When | Catches |
|---|---|---|
| Branch | before sync | Upstream on the wrong branch (wrong CDN base / wrong rewriter) |
| Freshness | before sync | A stale bundle when the upstream compile didn't run |
| **Output** | after rewrite, before commit | Foreign CDN repos in `index.html`, or a rewrite that didn't run (floor of 150 URLs; healthy ≈ 178) |

The output guard is the one that matters — it's cause-agnostic, so it catches classes
of failure the input guards don't anticipate. Details in `app/scripts/README.md`.

## Known gotchas

1. **`update-build.py` never rewrites `index.html` in this repo.** Its regex
   (`app/scripts/update-build.py:67`) matches `shellbros/mathlete@…` — a leftover from
   the sibling `mathlete` repo. Nothing matches here, so it prints "No CDN URLs found"
   and only `build.json` is updated. Result: ~178 asset URLs (CSS, Vue, images, data
   JSON) stay pinned to the **previous** build's sha. `js/shellshock.js` is unaffected
   because it loads via `Loader.loadJS`. Fix: match `shellbros/shellbros\.github\.io@`.
2. **`sync.py:49` calls `makeShellhome.sh`** (lowercase `h`); the real file is
   `makeShellHome.sh`. Works only because macOS is case-insensitive.
3. **`makeShellHome.sh` has no `set -e`.** If `sudo ./compile.sh` fails — e.g. no tty —
   it prints an error and *keeps going*, silently shipping the previously compiled
   bundle. `build.sh`'s freshness guard is what stops this being a stale-ship bug, but
   check the output for `sudo: a password is required` before trusting a build.
4. **Agents cannot run the build unattended.** No tty means no sudo password, so the
   recompile is skipped. Run it from Terminal.app, or accept that the existing bundle
   is reused (fine if the freshness guard passed, but no fresh anti-cheat shuffle).
5. **`update-proxy-list.sh` rewrites tracked source.** It regenerates the `allowlist`
   array in `functions/_shared/wsProxy.js` from `root_domains.json` on every build.
   Don't hand-maintain that array. Its `.backup` file is gitignored.

## Related docs

- `app/scripts/README.md` — per-script runbook and troubleshooting
- `readme.md` — the Cloudflare Pages WebSocket proxy design
- `../ShellShockers/CLAUDE.md` — the game source repo
