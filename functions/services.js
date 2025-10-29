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
	const maxAttempts = 10;
	
	for (let i = 0; i < Math.min(maxAttempts, shuffledBackends.length); i++) {
	  const backend = shuffledBackends[i];
	  
	  try {
		const backendUrl = `wss://${backend}/services`;
		console.log(`[Services] Attempt ${i + 1}/${maxAttempts}: ${backendUrl}`);
  
		// Try to connect to backend WebSocket
		const backendWs = new WebSocket(backendUrl);
		
		// Wait for connection with timeout
		const connected = await Promise.race([
		  new Promise((resolve) => {
			backendWs.addEventListener('open', () => resolve(true), { once: true });
			backendWs.addEventListener('error', () => resolve(false), { once: true });
		  }),
		  new Promise((resolve) => setTimeout(() => resolve(false), 3000))
		]);
		
		if (!connected) {
		  backendWs.close();
		  throw new Error('Connection timeout or failed');
		}
		
		// Backend connected! Create WebSocketPair for client
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		
		// Pipe messages between client and backend
		backendWs.addEventListener('message', (event) => {
		  try {
			server.send(event.data);
		  } catch (e) {
			console.error('[Services] Error forwarding to client:', e);
		  }
		});
		
		server.addEventListener('message', (event) => {
		  try {
			if (backendWs.readyState === WebSocket.OPEN) {
			  backendWs.send(event.data);
			}
		  } catch (e) {
			console.error('[Services] Error forwarding to backend:', e);
		  }
		});
		
		// Handle closures
		backendWs.addEventListener('close', (event) => {
		  try {
			server.close(event.code, event.reason);
		  } catch (e) {}
		});
		
		server.addEventListener('close', (event) => {
		  try {
			backendWs.close(event.code, event.reason);
		  } catch (e) {}
		});
		
		// Accept the client connection
		server.accept();
		
		console.log(`[Services] ✓ Connected to ${backend}`);
		logSuccess(backend, ip, country);
		
		return new Response(null, {
		  status: 101,
		  webSocket: client,
		});
		
	  } catch (error) {
		const errorMsg = error.message || 'Failed';
		console.error(`[Services] ✗ ${backend}: ${errorMsg}`);
		errors.push({ backend, error: errorMsg });
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
	console.log(`[Analytics] Success: ${backend} | ${ip} | ${country}`);
}