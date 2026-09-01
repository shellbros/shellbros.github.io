#!/usr/bin/env node

/**
 * Generates standalone.html beside index.html.
 *
 * index.html is meant to be served from this repo's own origin. standalone.html
 * is the same page made safe to run with NO origin at all -- a blob: URL, an
 * about:blank iframe, or a file:// page -- where relative paths cannot resolve
 * and commit-pinned URLs silently freeze on an old build.
 *
 * Two transforms:
 *   1. Un-pin  gh/<owner>/<repo>@<sha>/  ->  @main/  so a copy of this file
 *      keeps working after future builds instead of pinning to the build that
 *      produced it.
 *   2. Absolutise the few remaining relative refs (favicons) against the CDN
 *      base the page already declares.
 *
 * Then it verifies its own output and exits non-zero if anything relative or
 * commit-pinned survived, so the build stops rather than shipping a file that
 * will half-load.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(REPO_ROOT, 'index.html');

if (!fs.existsSync(SRC)) {
	console.error('makeStandalone: index.html not found at ' + SRC);
	process.exit(1);
}

let html = fs.readFileSync(SRC, 'utf8');

// 1. Un-pin every commit-pinned jsDelivr URL.
const pinned = (html.match(/gh\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{7,40}\//g) || []).length;
html = html.replace(/(gh\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)@[0-9a-f]{7,40}\//g, '$1@main/');

// 2. Absolutise relative refs against the page's own declared CDN base.
const baseMatch = html.match(/window\.JSCDN\s*=\s*["']([^"']+)["']/);
if (!baseMatch) {
	console.error('makeStandalone: no window.JSCDN in index.html -- cannot resolve relative paths');
	process.exit(1);
}
const BASE = baseMatch[1].endsWith('/') ? baseMatch[1] : baseMatch[1] + '/';

// Name the file after the CDN repo it bootstraps from, so the two shells'
// standalone files are distinguishable without opening them.
const repoMatch = BASE.match(/gh\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)@/);
if (!repoMatch) {
	console.error('makeStandalone: could not read the CDN repo out of ' + BASE);
	process.exit(1);
}
const SLUG = repoMatch[2].replace(/\.github\.io$/, '');
const OUT = path.join(REPO_ROOT, `standalone-${SLUG}.html`);

const RELATIVE = /(src|href)="(?!https?:|\/\/|data:|blob:|#|mailto:)(\.\/)?([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:js|css|json|webp|png|svg|ico|jpg|jpeg|gif|mp3|mp4|webm|wasm))(\?[^"]*)?"/g;
let absolutised = 0;
html = html.replace(RELATIVE, (m, attr, dot, file, query) => {
	absolutised++;
	return `${attr}="${BASE}${file}${query || ''}"`;
});

// 3. Bake the socket host in.
//
// This file exists for contexts with no origin, where location.host is empty and
// wssHost() would otherwise wait on checker.js probing a proxy -- an async race
// against the game's own connect, and a needless round trip when the answer is
// already known. dynamicContentRoot is step 2 in wssHost(), ahead of
// location.host, and checker.js never touches it (it nulls overrideWssBase on
// every run, so baking THAT would be clobbered). servers.js only reassigns
// dynamicContentRoot for ?portalTest= or localhost, neither of which applies here.
const PROXY = `${SLUG}.pages.dev`;
const rootDecl = /var\s+dynamicContentRoot\s*=\s*''\s*;/;
if (!rootDecl.test(html)) {
	console.error("makeStandalone: could not find `var dynamicContentRoot = '';` to bake the socket host into");
	process.exit(1);
}
html = html.replace(rootDecl, `var dynamicContentRoot = '${PROXY}';`);

fs.writeFileSync(OUT, html, 'utf8');

// 3. Verify. A standalone file that still has either of these will half-load in
//    the exact environment it exists for, so fail the build instead.
const leftoverRelative = html.match(RELATIVE) || [];
const leftoverPinned = html.match(/gh\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{7,40}\//g) || [];

if (leftoverRelative.length || leftoverPinned.length) {
	console.error('makeStandalone: output failed verification');
	leftoverRelative.slice(0, 5).forEach(r => console.error('   relative: ' + r));
	leftoverPinned.slice(0, 5).forEach(r => console.error('   pinned:   ' + r));
	process.exit(1);
}

const cdnCount = (html.match(/cdn\.jsdelivr\.net\/gh\//g) || []).length;
console.log(`${path.basename(OUT)} written from ${repoMatch[1]}/${repoMatch[2]} (${cdnCount} CDN URLs, ${pinned} un-pinned, ${absolutised} absolutised, sockets -> ${PROXY})`);
