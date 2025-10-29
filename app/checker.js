/* ProxyFinder.js - plain JS */

(function (global) {
	'use strict';
  
	const DEFAULT_SOURCE_URL = '../root_domains.json';
  
	class ProxyFinder {
	  // ----- static state -----
	  static _domains = [];

	  static _index = 0;
	  static _isTesting = false;
	  static _domainsLoaded = false;
	  static _inflight = null; // AbortController for current probe
	  static _sourceUrl = DEFAULT_SOURCE_URL; // override via setSourceUrl()
	  static _requestTimeoutMs = 10000;   // override via setRequestTimeout()
	  static _debug = false; // if true, do not navigate; just log and short-circuit
	  // ----- matchmaker WebSocket state -----
	  static _ws = null;            // matchmaker WebSocket
	  static regionList = [];       // latest regions from matchmaker
	  // ----- region WebSocket handshake config -----
	  static _regionWsPaths = ['/ws/health', '/ws/game', '/ws'];
	  static setRegionWsPaths(paths) {
	    if (Array.isArray(paths) && paths.length) this._regionWsPaths = paths.map(String);
	  }
	  // ----- helpers for region WS handshake -----
	  static _buildRegionHosts(rootHost, subLabel) {
	    const subs = [];
	    const sub = String(subLabel || '').trim();
	    const root = String(rootHost || '').trim();
	    if (!sub) return subs;
	    // If sub already looks like a FQDN (contains a dot), try it as-is first
	    if (sub.includes('.')) subs.push(sub);
	    if (root) subs.push(`${sub}.${root}`);
	    // de-dup
	    return Array.from(new Set(subs));
	  }

	  static _wsHandshake(url, timeoutMs = 2000) {
	    return new Promise((resolve) => {
	      let done = false;
	      let ws;
	      const t = setTimeout(() => {
	        if (!done) { done = true; try { ws && ws.close(); } catch(_){}; resolve(Infinity); }
	      }, timeoutMs);
	      try { ws = new WebSocket(url); } catch (e) {
	        clearTimeout(t);
	        return resolve(Infinity);
	      }
	      ws.onopen = () => { if (!done) { done = true; clearTimeout(t); try{ws.close();}catch(_){}; resolve(10); } };
	      ws.onerror = () => { if (!done) { done = true; clearTimeout(t); resolve(Infinity); } };
	      ws.onclose = () => { if (!done) { done = true; clearTimeout(t); resolve(Infinity); } };
	    });
	  }

	  static async pingRegionHandshake(rootHost, region, timeoutMs = 2000) {
	    const hosts = this._buildRegionHosts(rootHost, region?.sub || region?.host || region?.id);
	    if (!hosts.length) return Infinity;
	    const paths = Array.isArray(this._regionWsPaths) && this._regionWsPaths.length ? this._regionWsPaths : ['/ws'];

	    // Try sequentially: first host, first path that succeeds wins
	    for (const h of hosts) {
	      for (const p of paths) {
	        const scheme = this._isHttps() ? 'wss' : 'ws';
	        const url = `${scheme}://${h}${p}`;
	        // console.log('[hs] try', url);
	        const ms = await this._wsHandshake(url, timeoutMs); // eslint-disable-line no-await-in-loop
	        if (Number.isFinite(ms)) return ms;
	      }
	    }
	    return Infinity;
	  }

	  // ----- environment detection -----
	  static isChromebook() {
		const ua = (global.navigator?.userAgent || '').toLowerCase();
		return ua.includes('cros') || ua.includes('chrome os');
	  }
  
	  static _host() {
		return (global.location?.hostname || '').toLowerCase();
	  }
  
	  static isGoogleSites() {
		const h = this._host();
		return (
		  h.includes('google.com') ||
		  h.includes('googleusercontent.com') ||
		  h.includes('googlesites.com')
		);
	  }
  
	  static isGitHub() {
		const h = this._host();
		return h.includes('github.io') || h.includes('github.com') || h.includes('githubusercontent.com');
	  }
  
	  static isGitLab() {
		const h = this._host();
		return h.includes('gitlab.io') || h.includes('gitlab.com') || h.includes('gitlabusercontent.com');
	  }
  
	  static isReplit() {
		const h = this._host();
		return h.includes('replit.com') || h.includes('repl.co') || h.includes('repl.it');
	  }
  
	  static getHostingPlatform() {
		if (this.isGoogleSites()) return 'Google Sites';
		if (this.isGitHub()) return 'GitHub';
		if (this.isGitLab()) return 'GitLab';
		if (this.isReplit()) return 'Replit';
		return 'Unknown';
	  }
  
	  static isSupportedHosting() {
		return this.isGoogleSites() || this.isGitHub() || this.isGitLab() || this.isReplit();
	  }
  
	  static _utmSource() {
		if (this.isGoogleSites()) return 'googlesites';
		if (this.isGitHub()) return 'github';
		if (this.isGitLab()) return 'gitlab';
		if (this.isReplit()) return 'replit';
		return 'unknown';
	  }
  
	  // ----- source / domain management -----
	  static _parseDomainsText(text) {
		// Split on commas or any whitespace; trim; dedupe
		const tokens = text.split(/[, \t\r\n]+/g).map(s => s.trim()).filter(Boolean);
		const seen = new Set(this._domains.map(d => d.toLowerCase().trim()));
		const out = [];
		for (const t of tokens) {
		  const k = t.toLowerCase();
		  if (!seen.has(k)) {
			seen.add(k);
			out.push(t);
		  }
		}
		return out;
	  }

	  static _ingestDomainArray(arr) {
		if (!Array.isArray(arr)) return;
		for (const raw of arr) {
		  if (typeof raw !== 'string') continue;
		  const t = raw.trim();
		  if (!t) continue;
		  const k = t.toLowerCase();
		  if (!this._domains.some(d => d.toLowerCase() === k)) {
			this._domains.push(t);
		  }
		}
	  }
  
	  static _resolveSourceCandidates() {
	    // Build absolute candidates from (a) configured string, (b) root-relative, (c) same-dir guesses
	    const base = (global.location && global.location.href) ? global.location.href : 'https://localhost/';
	    const configured = (() => { try { return new URL(this._sourceUrl, base).toString(); } catch { return this._sourceUrl; } })();
	    const guesses = [
	      configured,
	      '/root_domains.json',              // root-relative
	      'root_domains.json',               // same directory as page
	      new URL('../root_domains.json', base).toString(),
	      new URL('/app/root_domains.json', base).toString()
	    ];
	    // De-dup while preserving order
	    const seen = new Set();
	    const out = [];
	    for (const g of guesses) { const k = String(g); if (!seen.has(k)) { seen.add(k); out.push(k); } }
	    return out;
	  }

	  static async _loadDomainsFromSource() {
	    console.log('loading domains from', this._sourceUrl);
	    const candidates = this._resolveSourceCandidates();

	    let loaded = false;
	    let lastErr = null;

	    for (const url of candidates) {
	      try {
	        const res = await fetch(url, { method: 'GET', cache: 'no-store' });
	        console.log('[domains] try', url, '->', res.status, res.ok, res.headers.get('content-type'));
	        if (!res.ok) { continue; }

	        const ct = (res.headers.get('content-type') || '').toLowerCase();
	        if (ct.includes('application/json') || /\.json(\?|$)/i.test(url)) {
	          const data = await res.json();
	          if (Array.isArray(data)) this._ingestDomainArray(data);
	          else if (data && Array.isArray(data.domains)) this._ingestDomainArray(data.domains);
	          else console.warn('[domains] JSON structure not an array or {domains:[...]}', data);
	        } else {
	          const text = await res.text();
	          const extra = this._parseDomainsText(text);
	          if (extra.length) this._domains.push(...extra);
	        }
	        loaded = true;
	        break; // success
	      } catch (err) {
	        console.warn('[domains] fetch failed for', url, err?.name || err, err?.message || '');
	        lastErr = err;
	        continue;
	      }
	    }

	    // normalize & dedupe always
	    const seen = new Set();
	    const uniq = [];
	    for (const d of this._domains) {
	      const k = String(d).toLowerCase().trim();
	      if (k && !seen.has(k)) { seen.add(k); uniq.push(k); }
	    }
	    this._domains = uniq;

	    if (!loaded) {
	      console.error('[domains] none of the candidates loaded; last error:', lastErr?.name || lastErr, lastErr?.message || '');
	      // Minimal fallback so the rest of the flow can continue for debugging
	      if (this._domains.length === 0) {
	        console.warn('[domains] falling back to hardcoded probe list for debug');
	        this._domains = ['algebra.best'];
	      }
	    }

	    this._domainsLoaded = true;
	  }
  
	  static refreshDomains(onComplete = null) {
		this._domainsLoaded = false;
		this._loadDomainsFromSource().finally(() => {
		  if (typeof onComplete === 'function') onComplete();
		});
	  }
  
	  static getDomains() {
		return [...this._domains];
	  }
  
	  static getDomainCount() {
		return this._domains.length;
	  }
  
	  // ----- probing -----
	  static async _testDomain(domain, onSuccess, onError) {
		if (!domain || domain.length === 0) return;
	  
		// normalize host (strip scheme, path, query)
		const host = String(domain)
		  .trim()
		  .replace(/^[a-z]+:\/\//i, '')
		  .replace(/^\/\//, '')
		  .replace(/[#?].*$/, '')
		  .replace(/\/+.*/, '');
	  
		console.log('=== Testing domain:', host, '===');
	  
		// ===== STAGE 1: PHP Health Check (app-specific) =====
		const controller = new AbortController();
		this._inflight = controller;
		const timer = setTimeout(() => controller.abort(), this._requestTimeoutMs);
	  
		let phpOk = false;
		try {
		  const url = `https://${host}/pingtest.php`;
		  console.log('[Stage 1] PHP probe:', url);
	  
		  const res = await fetch(url, { method:'GET', cache:'no-store', signal: controller.signal });
		  const body = res.ok ? await res.text() : '';
		  console.log('[Stage 1] status:', res.status, 'ok:', res.ok);
		  console.log('[Stage 1] body preview:', body.slice(0, 80));
	  
		  phpOk = (res.ok && typeof body === 'string' && body.includes('shell.ok'));
		} catch (e) {
		  console.warn('[Stage 1] PHP probe failed:', e?.name || e, e?.message || '');
		} finally {
		  clearTimeout(timer);
		  if (this._inflight === controller) this._inflight = null;
		}
	  
		// If PHP ping succeeded → immediate success
		if (phpOk) {
		  console.log('[Stage 1] ✓ PHP health check passed');
		  if (this._debug) {
			console.log('[DEBUG] shell.ok detected; would redirect to https://'+host);
			onSuccess?.();
			return;
		  }
		  const utm = this._utmSource();
		  global.location.replace(`https://${host}?utm_source=${utm}`);
		  onSuccess?.();
		  return;
		}
	  
		console.log('[Stage 1] ✗ PHP health check failed, trying image probe...');
	  
		// ===== STAGE 2: Image Probe (basic reachability) =====
		const imgOk = await this._testImageProbe(host, 3000);
		
		if (!imgOk) {
		  console.log('[Stage 2] ✗ Image probe failed - domain appears unreachable');
		  // Domain is blocked/down → skip immediately
		  onError?.();
		  return;
		}
	  
		console.log('[Stage 2] ✓ Image probe passed - domain is reachable');
	  
		// ===== STAGE 3: WebSocket Region Selection =====
		console.log('[Stage 3] Attempting WebSocket region selection...');
		try {
		  const wsTimeoutPerRegion = Math.min(4000, Math.max(1000, this._requestTimeoutMs));
		  const best = await this.findBestRegion(host, wsTimeoutPerRegion);
		  console.log('[Stage 3] Best region:', best);
	  
		  if (best && Number.isFinite(best.ping)) {
			console.log(`[Stage 3] ✓ Found best region: ${best.id} (${best.ping.toFixed(0)}ms)`);
			
			if (this._debug) {
			  console.log(`[DEBUG] WS region selection ok; region=${best.id} ping=${best.ping.toFixed(0)}ms; would redirect to https://${host}`);
			  onSuccess?.();
			  return;
			}
			
			const utm = this._utmSource();
			const url = new URL(`https://${host}`);
			url.searchParams.set('utm_source', utm);
			url.searchParams.set('region', String(best.id));
			global.location.replace(url.toString());
			onSuccess?.();
			return;
		  }
		  
		  console.log('[Stage 3] ✗ No healthy region found');
		} catch (e) {
		  console.warn('[Stage 3] WebSocket region selection failed:', e?.name || e, e?.message || '');
		}
	  
		// All three stages failed
		console.log('=== All tests failed for', host, '===');
		onError?.();
	  }
  
	  static async _testNextDomain() {
		console.log('testing next domain');
		if (!this._isTesting) return;
  
		if (this._index >= this._domains.length) {
		  this._sendFailureEvent();
		  this._isTesting = false;
		  return;
		}
  
		const domain = this._domains[this._index++];
		await this._testDomain(
		  domain,
		  // success
		  () => {
			this._isTesting = false; // redirect already triggered
		  },
		  // failure: small delay then continue
		  () => {
			if (!this._isTesting) return;
			setTimeout(() => this._testNextDomain(), 100);
		  }
		);
	  }
  
	  static async _ensureDomainsThen(fn) {
		console.log('ensureDomainsThen', this._domainsLoaded);
		if (this._domainsLoaded) {
		  await fn();
		} else {
		  await this._loadDomainsFromSource();
		  console.log('loaded domains', this._domains);
		  await fn();
		}
	  }
  
	  static _sendFailureEvent() {
		setTimeout(() => {
		  const dl = global.window?.dataLayer;
		  if (dl && typeof dl.push === 'function') {
			dl.push({
			  event: 'all_proxies_failed',
			  event_category: 'proxy_test',
			  event_label: 'all_domains_failed'
			});
		  }
		}, 30000);
	  }

	  // ----- matchmaker / WebSocket helpers -----
	  static _isHttps() {
		try { return (global.location?.protocol || '').toLowerCase().startsWith('https'); } catch (_) { return true; }
	  }

	  static _newWS(url) {
		const Ctor = (global.ReliableWebSocket) ? global.ReliableWebSocket : global.WebSocket;
		return new Ctor(url);
	  }

	  static handleMatchmakerMessage(e) {}
	  static handleError(e) { console.log('handleError', e); }

	  // ----- matchmaker WebSocket region selection -----
	  static connect(domain) {
		return new Promise((res, fail) => {
		  try {
			const host = String(domain || '')
			  .trim()
			  .replace(/^[a-z]+:\/\//i, '')
			  .replace(/^\/\//, '')
			  .replace(/[#?].*$/, '')
			  .replace(/\/+.*/, '');
			console.log('ws host', host);
			if (!host) return fail(new Error('No host available for matchmaker WS'));
			// const scheme = this._isHttps() ? 'wss' : 'ws';
			const scheme = 'wss';
			const url = `${scheme}://${host}/matchmaker/`;
			console.log('ws url', url);
			this._ws = this._newWS(url);

			this._ws.onopen = () => res(this._ws);
			this._ws.onmessage = (e) => this.handleMatchmakerMessage(e);
			this._ws.onerror = (err) => { /* swallow here; getRegions will handle */ };
		  } catch (e) {
			fail(e);
		  }
		});
	  }

	  static getRegions() {
		return new Promise((res, fail) => {
		  if (!this._ws || this._ws.readyState !== 1) return fail(new Error('WebSocket not open'));

		  // Ask for the list
		  this._ws.send('{ "command": "regionList" }');

		  const onMessage = (e) => {
			try {
			  const data = JSON.parse(e.data);
			  console.log('getRegions data', data);
			  if (data && data.command === 'regionList') {
				this._ws.removeEventListener('message', onMessage);
				this.regionList = Array.isArray(data.regionList) ? data.regionList.slice() : [];
				for (const r of this.regionList) {
				  r.locKey = 'server_' + r.id;
				  r.ping = null;
				}
				res(this.regionList);
				return;
			  }
			} catch(_) { /* fallthrough to app handler */ }
			this.handleMatchmakerMessage(e);
		  };

		  const onError = (err) => {
			try { this._ws.removeEventListener('message', onMessage); } catch(_) {}
			fail(err);
			this.handleError(err);
		  };

		  this._ws.addEventListener('message', onMessage);
		  this._ws.addEventListener('error', onError, { once: true });
		});
	  }

	  static pingRegion(regionId, timeoutMs = 1500) {
		return new Promise((resolve) => {
		  if (!this._ws || this._ws.readyState !== 1) return resolve(Infinity);
	  
		  const nonce = Math.random().toString(36).slice(2);
		  const started = (performance && performance.now) ? performance.now() : Date.now();
	  
		  const onMessage = (e) => {
			try {
			  const data = JSON.parse(e.data);
	  
			  // Accept common shapes:
			  // {command:'pong', regionId, nonce}
			  // {command:'pong', region: regionId, nonce}
			  // {command:'pong', id: regionId, nonce}
			  // {command:'pong', nonce}  // no region field
			  const isPong = data && data.command === 'pong';
			  const nonceOk = data && data.nonce === nonce;
			  const regionOk =
				data?.regionId === regionId ||
				data?.region === regionId ||
				data?.id === regionId ||
				data?.regionId === undefined && data?.region === undefined && data?.id === undefined; // accept no region field
	  
			  if (isPong && nonceOk && regionOk) {
				this._ws.removeEventListener('message', onMessage);
				const t = (performance && performance.now) ? (performance.now() - started) : (Date.now() - started);
				resolve(t);
			  }
			} catch (_) {
			  // ignore other messages
			}
		  };
	  
		  this._ws.addEventListener('message', onMessage);
	  
		  // Try multiple possible command names the server might expect.
		  const payloads = [
			{ command: 'ping', regionId, nonce },
			{ command: 'ping', region: regionId, nonce },
			{ command: 'ping', id: regionId, nonce },
		  ];
		  try { this._ws.send(JSON.stringify(payloads[0])); } catch (_) {}
		  // Send a second variant after 50ms in case the server expects a different key
		  setTimeout(() => { try { this._ws.send(JSON.stringify(payloads[1])); } catch (_) {} }, 50);
	  
		  setTimeout(() => {
			try { this._ws.removeEventListener('message', onMessage); } catch {}
			resolve(Infinity);
		  }, 10000);
		});
	  }

	  static async findBestRegion(domain, timeoutPerRegionMs = 1500) {
	    await this.connect(domain);
	    const regions = await this.getRegions();
	    console.log('regions', regions);
	    if (!regions || !regions.length) return null;

	    const measures = await Promise.all(regions.map(r => this.pingRegionHandshake(domain, r, timeoutPerRegionMs)));
	    console.log('handshake measures', measures);

	    let best = null, bestT = Infinity;
	    for (let i = 0; i < regions.length; i++) {
	      regions[i].ping = measures[i];
	      if (measures[i] < bestT) { bestT = measures[i]; best = regions[i]; }
	    }

	    return best; // { id, sub, ping, ... }
	  }

	  static async getRegionPings(domain, timeoutPerRegionMs = 1500) {
		await this.connect(domain);
		const regions = await this.getRegions();
		const measures = await Promise.all(regions.map(r => this.pingRegion(r.id, timeoutPerRegionMs)));
		for (let i = 0; i < regions.length; i++) regions[i].ping = measures[i];
		const sorted = regions.slice().sort((a,b) => (a.ping||1e9) - (b.ping||1e9));
		return { best: sorted[0] || null, regions: sorted };
	  }

	  static async _testImageProbe(host, timeoutMs = 5000) {
		return new Promise((resolve) => {
		  const img = new Image();
		  const timer = setTimeout(() => {
			img.src = ''; // cancel load
			resolve(false);
		  }, timeoutMs);
		  
		  img.onload = () => {
			clearTimeout(timer);
			resolve(true);
		  };
		  
		  img.onerror = () => {
			clearTimeout(timer);
			resolve(false);
		  };
		  
		  // Try favicon with cache-busting
		  img.src = `https://${host}/favicon.ico?t=${Date.now()}`;
		});
	  }

	  // ----- public API -----
	  static start() {
		console.log('Starting proxy checker');
		if (this._isTesting) return;
		// if (!(this.isChromebook() && this.isSupportedHosting())) return;

		this._isTesting = true;
		this._index = 0;
		this._ensureDomainsThen(() => this._testNextDomain());
	  }
  
	  static forceStart() {
		if (this._isTesting) return;
		this._isTesting = true;
		this._index = 0;
		this._ensureDomainsThen(() => this._testNextDomain());
	  }
  
	  static stop() {
		this._isTesting = false;
		this._index = 0;
		try {
		  this._inflight?.abort();
		} catch (_) { /* noop */ }
		this._inflight = null;
	  }
  
	  static isCurrentlyTesting() {
		return this._isTesting;
	  }
  
	  static getCurrentDomain() {
		if (this._index > 0 && this._index <= this._domains.length) {
		  return this._domains[this._index - 1];
		}
		return '';
	  }
  
	  // ----- config knobs (optional) -----
	  static setSourceUrl(url) {
		this._sourceUrl = String(url || DEFAULT_SOURCE_URL);
	  }
  
	  static setRequestTimeout(ms) {
		const n = Number(ms);
		if (Number.isFinite(n) && n > 0) this._requestTimeoutMs = n | 0;
	  }

	  static setDebug(v) {
		this._debug = !!v;
	  }
	}
  
	// export UMD-style
	if (typeof module !== 'undefined' && module.exports) {
	  module.exports = ProxyFinder;
	} else {
	  global.ProxyFinder = ProxyFinder;
	}
  })(typeof window !== 'undefined' ? window : globalThis);

// ===== TEST HARNESS =====
class ProxyFinderTests {
	static async runAllTests() {
	  console.log('\n\n========================================');
	  console.log('🧪 PROXYFINDER TEST SUITE');
	  console.log('========================================\n');
  
	  // Enable debug mode to prevent actual redirects
	  ProxyFinder.setDebug(true);
	  ProxyFinder.setRequestTimeout(5000);
  
	  await this.test1_AllPass();
	  await this.test2_PHPFailImagePassWSPass();
	  await this.test3_PHPFailImageFail();
	  await this.test4_PHPFailImagePassWSFail();
	  await this.test5_RealDomainTest();
  
	  console.log('\n========================================');
	  console.log('✅ ALL TESTS COMPLETE');
	  console.log('========================================\n');
	}
  
	// Test 1: Everything works (PHP returns shell.ok)
	static async test1_AllPass() {
	  console.log('\n--- 🧪 TEST 1: All Pass (PHP Success) ---');
	  console.log('Expected: Stage 1 succeeds, redirects immediately\n');
  
	  // Mock fetch to return successful PHP response
	  const originalFetch = window.fetch;
	  window.fetch = async (url, options) => {
		if (url.includes('pingtest.php')) {
		  return {
			ok: true,
			status: 200,
			headers: { get: () => 'text/html' },
			text: async () => 'shell.ok'
		  };
		}
		return originalFetch(url, options);
	  };
  
	  let successCalled = false;
	  let errorCalled = false;
  
	  await ProxyFinder._testDomain(
		'example.com',
		() => { successCalled = true; },
		() => { errorCalled = true; }
	  );
  
	  console.log('📞 Success callback:', successCalled ? 'CALLED ✅' : 'NOT CALLED ❌');
	  console.log('📞 Error callback:', errorCalled ? 'CALLED ❌' : 'NOT CALLED ✅');
	  console.log(successCalled && !errorCalled ? '✅ TEST PASSED' : '❌ TEST FAILED');
  
	  // Restore
	  window.fetch = originalFetch;
	}
  
	// Test 2: PHP fails, image passes, WS passes
	static async test2_PHPFailImagePassWSPass() {
	  console.log('\n--- 🧪 TEST 2: PHP Fail → Image Pass → WS Pass ---');
	  console.log('Expected: Stage 1 fails, Stage 2 passes, Stage 3 succeeds with region\n');
  
	  const originalFetch = window.fetch;
	  const originalImage = window.Image;
	  const originalConnect = ProxyFinder.connect;
	  const originalGetRegions = ProxyFinder.getRegions;
	  const originalPingRegionHandshake = ProxyFinder.pingRegionHandshake;
  
	  // Mock fetch to fail PHP
	  window.fetch = async (url, options) => {
		if (url.includes('pingtest.php')) {
		  throw new Error('Connection refused');
		}
		return originalFetch(url, options);
	  };
  
	  // Mock Image to succeed
	  window.Image = class {
		set src(url) {
		  setTimeout(() => {
			if (this.onload) this.onload();
		  }, 100);
		}
	  };
  
	  // Mock WebSocket region selection
	  ProxyFinder.connect = async () => ({ readyState: 1 });
	  ProxyFinder.getRegions = async () => [
		{ id: 'us-east', sub: 'us-east' },
		{ id: 'eu-west', sub: 'eu-west' }
	  ];
	  ProxyFinder.pingRegionHandshake = async () => 50; // 50ms ping
  
	  let successCalled = false;
	  let errorCalled = false;
  
	  await ProxyFinder._testDomain(
		'example.com',
		() => { successCalled = true; },
		() => { errorCalled = true; }
	  );
  
	  console.log('📞 Success callback:', successCalled ? 'CALLED ✅' : 'NOT CALLED ❌');
	  console.log('📞 Error callback:', errorCalled ? 'CALLED ❌' : 'NOT CALLED ✅');
	  console.log(successCalled && !errorCalled ? '✅ TEST PASSED' : '❌ TEST FAILED');
  
	  // Restore
	  window.fetch = originalFetch;
	  window.Image = originalImage;
	  ProxyFinder.connect = originalConnect;
	  ProxyFinder.getRegions = originalGetRegions;
	  ProxyFinder.pingRegionHandshake = originalPingRegionHandshake;
	}
  
	// Test 3: PHP fails, image fails (domain blocked)
	static async test3_PHPFailImageFail() {
	  console.log('\n--- 🧪 TEST 3: PHP Fail → Image Fail (Domain Blocked) ---');
	  console.log('Expected: Stage 1 fails, Stage 2 fails, error callback immediately\n');
  
	  const originalFetch = window.fetch;
	  const originalImage = window.Image;
  
	  // Mock fetch to fail PHP
	  window.fetch = async (url, options) => {
		if (url.includes('pingtest.php')) {
		  throw new Error('Connection refused');
		}
		return originalFetch(url, options);
	  };
  
	  // Mock Image to fail
	  window.Image = class {
		set src(url) {
		  setTimeout(() => {
			if (this.onerror) this.onerror();
		  }, 100);
		}
	  };
  
	  let successCalled = false;
	  let errorCalled = false;
  
	  await ProxyFinder._testDomain(
		'blocked-domain.com',
		() => { successCalled = true; },
		() => { errorCalled = true; }
	  );
  
	  console.log('📞 Success callback:', successCalled ? 'CALLED ❌' : 'NOT CALLED ✅');
	  console.log('📞 Error callback:', errorCalled ? 'CALLED ✅' : 'NOT CALLED ❌');
	  console.log(!successCalled && errorCalled ? '✅ TEST PASSED' : '❌ TEST FAILED');
  
	  // Restore
	  window.fetch = originalFetch;
	  window.Image = originalImage;
	}
  
	// Test 4: PHP fails, image passes, WS fails
	static async test4_PHPFailImagePassWSFail() {
	  console.log('\n--- 🧪 TEST 4: PHP Fail → Image Pass → WS Fail ---');
	  console.log('Expected: Stage 1 fails, Stage 2 passes, Stage 3 fails, error callback\n');
  
	  const originalFetch = window.fetch;
	  const originalImage = window.Image;
	  const originalConnect = ProxyFinder.connect;
  
	  // Mock fetch to fail PHP
	  window.fetch = async (url, options) => {
		if (url.includes('pingtest.php')) {
		  throw new Error('Connection refused');
		}
		return originalFetch(url, options);
	  };
  
	  // Mock Image to succeed
	  window.Image = class {
		set src(url) {
		  setTimeout(() => {
			if (this.onload) this.onload();
		  }, 100);
		}
	  };
  
	  // Mock WebSocket to fail
	  ProxyFinder.connect = async () => {
		throw new Error('WebSocket connection failed');
	  };
  
	  let successCalled = false;
	  let errorCalled = false;
  
	  await ProxyFinder._testDomain(
		'example.com',
		() => { successCalled = true; },
		() => { errorCalled = true; }
	  );
  
	  console.log('📞 Success callback:', successCalled ? 'CALLED ❌' : 'NOT CALLED ✅');
	  console.log('📞 Error callback:', errorCalled ? 'CALLED ✅' : 'NOT CALLED ❌');
	  console.log(!successCalled && errorCalled ? '✅ TEST PASSED' : '❌ TEST FAILED');
  
	  // Restore
	  window.fetch = originalFetch;
	  window.Image = originalImage;
	  ProxyFinder.connect = originalConnect;
	}
  
	// Test 5: Real domain test (no mocking, actual network call)
	static async test5_RealDomainTest() {
	  console.log('\n--- 🧪 TEST 5: Real Domain Test (google.com) ---');
	  console.log('Expected: PHP fails (no pingtest.php), image passes (favicon exists)\n');
  
	  let successCalled = false;
	  let errorCalled = false;
  
	  await ProxyFinder._testDomain(
		'google.com',
		() => { successCalled = true; },
		() => { errorCalled = true; }
	  );
  
	  console.log('📞 Success callback:', successCalled ? 'CALLED ✅' : 'NOT CALLED ❌');
	  console.log('📞 Error callback:', errorCalled ? 'CALLED ❌' : 'NOT CALLED ✅');
	  console.log('ℹ️ Note: Result depends on google.com WebSocket availability');
	}
  }
  
  // Auto-run tests if you want (or call manually)
  // ProxyFinderTests.runAllTests();
  
  // Auto-run tests if you want (or call manually)
  // ProxyFinderTests.runAllTests();

// ProxyFinder.setDebug(true); // uncomment for test mode (no redirects)
ProxyFinder.start();