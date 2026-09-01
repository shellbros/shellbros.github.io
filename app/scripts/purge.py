#!/usr/bin/env python3
"""
Purge the jsDelivr cache, then verify the edge actually refetched.

Run AFTER pushing.

Only URLs something actually reads are listed. jsDelivr caches every distinct URL
as a separate object, so `/gh/o/r/f` and `/gh/o/r@main/f` are two caches of the
same file and purging one does nothing for the other. Commit-pinned `@<sha>` URLs
are immutable and never need purging -- each build mints a new sha.

Purging is not proof of anything on its own: jsDelivr answers
`{"status": "finished", "throttled": true}` when the same path is purged repeatedly
in quick succession, and that looks identical to success. So this reads build.json
back afterwards and compares it against the local one.

Usage:
    python3 purge.py
"""

import json
import sys
import urllib.request
from pathlib import Path

# What reads what, as of the Vue 3 / standalone work:
#   app/checker.js and index.html both fetch the UNPINNED build.json <- critical
#   standalone-shellbros.html loads @main/app/checker.js and @main/js/shellshock.js,
#   and is itself handed out from @main
# NOTE: unlike mathlete, the unpinned URL is the one this repo's code reads. Do not
# "align" these two files -- they are correctly different.
PURGE_URLS = [
    # checker.js and index.html's Loader.getBuildSha() both read this. Miss it and
    # every client keeps resolving the previous build's sha.
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io/app/build.json",
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io/app/checker.js",
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io/index.html",
    # standalone-shellbros.html is handed out and pins everything to @main, so these
    # are separate cache objects from the unpinned ones above.
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io@main/standalone-shellbros.html",
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io@main/app/checker.js",
    "https://purge.jsdelivr.net/gh/shellbros/shellbros.github.io@main/js/shellshock.js",
]

# checker.js reads this; it is what the verification below checks.
VERIFY_URL = "https://cdn.jsdelivr.net/gh/shellbros/shellbros.github.io/app/build.json"
LOCAL_BUILD_JSON = Path(__file__).resolve().parent.parent / "build.json"


def purge(url):
    """Purge one URL. Returns (ok, throttled)."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as r:
            body = json.loads(r.read().decode())
    except Exception as e:
        print(f"  FAILED  {url}\n          {e}")
        return False, False

    throttled = any(p.get("throttled") for p in body.get("paths", {}).values())
    status = body.get("status", "?")
    print(f"  {status:<9}{'(throttled)' if throttled else '':<13}{url}")
    return status == "finished", throttled


def main():
    print("Purging jsDelivr...")
    failed = throttled_any = False
    for url in PURGE_URLS:
        ok, throttled = purge(url)
        failed |= not ok
        throttled_any |= throttled

    # The point of the exercise: did the edge actually pick up the new build?
    print("\nVerifying the edge refetched...")
    try:
        local = json.loads(LOCAL_BUILD_JSON.read_text())
    except Exception as e:
        print(f"  cannot read {LOCAL_BUILD_JSON}: {e}")
        return 1

    try:
        with urllib.request.urlopen(VERIFY_URL, timeout=30) as r:
            served = json.loads(r.read().decode())
    except Exception as e:
        print(f"  cannot read {VERIFY_URL}: {e}")
        return 1

    lv, sv = local.get("build_version"), served.get("build_version")
    if lv == sv:
        print(f"  OK      CDN serves {sv} (build {served.get('build_number')})")
        return 1 if failed else 0

    print(f"  STALE   CDN serves {sv}, local is {lv}")
    if throttled_any:
        print("          A purge was throttled. Wait a few minutes -- re-purging")
        print("          the same path extends the throttle rather than clearing it.")
    else:
        print("          Did the push land? Check `git log origin/main..main`.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
