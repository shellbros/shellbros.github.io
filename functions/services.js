/**
 * WebSocket Proxy for ShellShock.io / Egg Games
 * Project: shellbros.pages.dev
 * Automatically fails over between 80+ backend game servers
 */

export async function onRequest(context) {
	const { request, env } = context;
	
	// ============================================
	// 1. VERIFY WEBSOCKET UPGRADE REQUEST
	// ============================================
	const upgradeHeader = request.headers.get('Upgrade');
	
	if (!upgradeHeader || upgradeHeader !== 'websocket') {
	  return new Response('This endpoint only accepts WebSocket connections', { 
		status: 426,
		headers: { 
		  'Upgrade': 'websocket',
		  'Content-Type': 'text/plain'
		}
	  });
	}
  
	// ============================================
	// 2. BACKEND SERVERS (All your domains)
	// ============================================
const backends = [
  "shellshock.io",
  "algebra.best",
  "algebra.vip",
  "algebra.monster",
  "biologyclass.club",
  "combateggs.com",
  "deadlyegg.com",
  "deathegg.life",
  "deathegg.world",
  "egg.dance",
  "eggbattle.com",
  "eggboy.club",
  "eggcombat.com",
  "eggfacts.fun",
  "egggames.best",
  "egghead.institute",
  "eggisthenewblack.com",
  "eggsarecool.com",
  "eggshock.com",
  "eggshock.me",
  "eggshock.net",
  "eggshooter.best",
  "eggshooter.com",
  "eggtown.org",
  "eggwarfare.com",
  "eggwars.io",
  "geometry.best",
  "geometry.monster",
  "geometry.pw",
  "geometry.report",
  "hardboiled.life",
  "hardshell.life",
  "historicreview.com",
  "humanorganising.org",
  "mathactivity.club",
  "mathactivity.xyz",
  "mathdrills.info",
  "mathdrills.life",
  "mathfun.rocks",
  "mathgames.world",
  "math.international",
  "mathlete.fun",
  "mathlete.pro",
  "overeasy.club",
  "risenegg.com",
  "scrambled.us",
  "scrambled.tech",
  "scrambled.world",
  "scrambled.today",
  "scrambled.best",
  "shellgame.me",
  "shellgame.one",
  "shellgame.quest",
  "shellplay.live",
  "shellplay.org",
  "shellshock.guru",
  "shellshockers.ca",
  "shellshockers.us",
  "shellshockers.life",
  "shellshockers.best",
  "shellshockers.website",
  "shellshockers.wiki",
  "shellshockers.xyz",
  "shellshockers.club",
  "shellshockers.world",
  "shellshockers.site",
  "shellshockers.today",
  "shockers.live",
  "shockers.one",
  "softboiled.club",
  "yolk.life",
  "yolk.tech",
  "yolk.rocks",
  "yolk.best",
  "violentegg.club",
  "violentegg.fun",
  "zygote.cafe",
  "shellsocks.com",
  "urbanegger.com",
  "eggboy.me",
  "eggboy.xyz",
  "yolk.quest",
  "yolk.today",
  "yolk.monster"
];
  
	// Shuffle backends for load distribution
	// This prevents everyone hammering the first domain
	const shuffledBackends = shuffleArray([...backends]);
  
	// ============================================
	// 3. CONNECTION INFO (for debugging)
	// ============================================
	const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
	const country = request.headers.get('CF-IPCountry') || 'unknown';
	
	console.log(`[Services] New connection from ${ip} (${country})`);
  
	// ============================================
	// 4. TRY BACKENDS UNTIL ONE WORKS
	// ============================================
	const errors = [];
	const maxAttempts = 10; // Don't try all 80+ domains, just first 10
	
	for (let i = 0; i < Math.min(maxAttempts, shuffledBackends.length); i++) {
	  const backend = shuffledBackends[i];
	  
	  try {
		// Build backend URL
		const backendUrl = new URL(request.url);
		backendUrl.protocol = 'wss:';
		backendUrl.hostname = backend;
		// Path stays the same (should be /services)
		
		console.log(`[Services] Attempt ${i + 1}/${maxAttempts}: ${backend}${backendUrl.pathname}`);
  
		// Set timeout for this attempt (3 seconds)
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3000);
  
		// Create new headers with correct Host header for backend
		const backendHeaders = new Headers(request.headers);
		backendHeaders.set('Host', backend);  // ✅ FIX: Set Host to backend domain
		
		// Forward the WebSocket upgrade request
		const response = await fetch(backendUrl.toString(), {
		  method: request.method,
		  headers: backendHeaders,  // ✅ Use corrected headers
		  signal: controller.signal,
		});
  
		clearTimeout(timeoutId);
  
		// Check if upgrade succeeded (HTTP 101)
		if (response.status === 101) {
		  console.log(`[Services] ✓ Connected to ${backend}`);
		  
		  // Optional: Log which backend worked
		  logSuccess(backend, ip, country);
		  
		  // Return the WebSocket connection to client
		  return response;
		}
  
		// Non-101 status
		const errorMsg = `HTTP ${response.status}`;
		console.log(`[Services] ✗ ${backend}: ${errorMsg}`);
		errors.push({ backend, error: errorMsg });
		
	  } catch (error) {
		const errorMsg = error.name === 'AbortError' ? 'Timeout' : (error.message || 'Failed');
		console.error(`[Services] ✗ ${backend}: ${errorMsg}`);
		errors.push({ backend, error: errorMsg });
		
		// Continue to next backend
		continue;
	  }
	}
  
	// ============================================
	// 5. ALL BACKENDS FAILED
	// ============================================
	console.error(`[Services] Failed after ${maxAttempts} attempts:`, errors);
	
	return new Response(JSON.stringify({
	  error: 'SERVICE_UNAVAILABLE',
	  message: 'Unable to connect to game servers. All servers are currently unavailable or blocked.',
	  attempts: errors.length,
	  totalServers: backends.length,
	  testedServers: errors.map(e => e.backend),
	  timestamp: new Date().toISOString(),
	  help: 'Try again in a few moments, or contact support if this persists.'
	}), { 
	  status: 503,
	  headers: {
		'Content-Type': 'application/json',
		'Retry-After': '30',
		'Cache-Control': 'no-store'
	  }
	});
  }
  
  /**
   * Shuffle array for load distribution
   * Fisher-Yates shuffle algorithm
   */
  function shuffleArray(array) {
	for (let i = array.length - 1; i > 0; i--) {
	  const j = Math.floor(Math.random() * (i + 1));
	  [array[i], array[j]] = [array[j], array[i]];
	}
	return array;
  }
  
  /**
   * Log successful connections (optional, non-blocking)
   */
  function logSuccess(backend, ip, country) {
	// You can enable this later for analytics
	// For now it just logs to console
	console.log(`[Analytics] Success: ${backend} | ${ip} | ${country}`);
	
	// TODO: Send to analytics endpoint if needed
	// fetch('https://your-analytics-endpoint.com/log', { ... })
  }
