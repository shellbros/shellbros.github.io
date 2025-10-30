export async function onRequest(context) {
    const { request, env } = context;
    
    // Log the incoming request
    console.log('[Proxy] Request to:', request.url);
    
    if (!env.HMAC_SECRET) {
        console.error('[Proxy] HMAC_SECRET not configured');
        return new Response('Server misconfigured', { status: 500 });
    }
    
    const upgradeHeader = request.headers.get('Upgrade');
    
    // Capture client-requested subprotocol (if any)
    const clientProtoHeader = request.headers.get('sec-websocket-protocol') || '';
    const clientProtocols = clientProtoHeader.split(',').map(s => s.trim()).filter(Boolean);
    const selectedClientProto = clientProtocols[0] || null; // choose the first one if provided
    
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
        console.log('[Proxy] Not a WebSocket upgrade request');
        return new Response('Expected WebSocket', { status: 426 });
    }

    const backends = [
        "dev.shellshock.io"
    ];

    const clientIP = request.headers.get('CF-Connecting-IP');
    const country = request.headers.get('CF-IPCountry') || 'unknown';
    
    if (!clientIP) {
        console.error('[Proxy] No CF-Connecting-IP header');
        return new Response('Unable to determine client IP', { status: 500 });
    }
    
    console.log(`[Proxy] Client ${clientIP} (${country})`);
    
    try {
        const token = await createAuthToken(clientIP, env.HMAC_SECRET);
        console.log(`[Proxy] Token generated: ${token.substring(0, 20)}...`);
        
        const shuffled = shuffleArray([...backends]);
        const maxAttempts = 10;
        
        for (let i = 0; i < Math.min(maxAttempts, shuffled.length); i++) {
            const backend = shuffled[i];
            
            try {
                const backendUrl = `wss://${backend}/matchmaker`;
                console.log(`[Proxy] Attempt ${i + 1}: ${backendUrl}`);
                
                const upstreamProtocols = selectedClientProto ? [selectedClientProto, token] : [token];
                const backendWs = new WebSocket(backendUrl, upstreamProtocols);
                
                const connected = await Promise.race([
                    new Promise((resolve) => {
                        backendWs.addEventListener('open', () => resolve(true), { once: true });
                        backendWs.addEventListener('error', (e) => {
                            const msg = e?.message || (e?.error && e.error.message) || String(e);
                            console.log('[Proxy] WS error:', msg);
                            resolve(false);
                        }, { once: true });
                    }),
                    new Promise((resolve) => setTimeout(() => resolve(false), 8000))
                ]);
                
                if (!connected) {
                    backendWs.close();
                    console.log('[Proxy] Connection failed or timeout');
                    continue;
                }
                
                const pair = new WebSocketPair();
                const [client, server] = Object.values(pair);
                
                backendWs.addEventListener('message', (event) => {
                    try {
                        server.send(event.data);
                    } catch (e) {
                        console.error('[Proxy] Error forwarding to client:', e.message);
                    }
                });
                
                server.addEventListener('message', (event) => {
                    try {
                        if (backendWs.readyState === WebSocket.OPEN) {
                            backendWs.send(event.data);
                        }
                    } catch (e) {
                        console.error('[Proxy] Error forwarding to backend:', e.message);
                    }
                });
                
                backendWs.addEventListener('close', (event) => {
                    console.log(`[Proxy] Backend closed: ${event.code} ${event.reason}`);
                    try {
                        server.close(event.code, event.reason);
                    } catch (e) {}
                });
                
                server.addEventListener('close', (event) => {
                    console.log(`[Proxy] Client closed: ${event.code} ${event.reason}`);
                    try {
                        backendWs.close(event.code, event.reason);
                    } catch (e) {}
                });
                
                server.accept();
                
                console.log(`[Proxy] ✓ Connected to ${backend} for ${clientIP}`);
                
                const responseHeaders = new Headers();
                if (selectedClientProto) {
                    // Echo one selected subprotocol back to the client per RFC 6455
                    responseHeaders.set('Sec-WebSocket-Protocol', selectedClientProto);
                }

                return new Response(null, {
                    status: 101,
                    webSocket: client,
                    headers: responseHeaders,
                });
                
            } catch (error) {
                console.error(`[Proxy] ✗ ${backend}:`, error.message, error.stack);
                continue;
            }
        }
        
        console.error('[Proxy] All backends failed');
        return new Response('All backends failed', { status: 503 });
        
    } catch (error) {
        console.error('[Proxy] Fatal error:', error.message, error.stack);
        return new Response('Internal server error', { status: 500 });
    }
}

async function createAuthToken(ip, secret) {
    const timestamp = Date.now().toString();
    const data = `${ip}|${timestamp}`;
    
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(data)
    );
    
    const sigHex = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const token = `${data}|${sigHex}`;
    
    return base64urlEncode(token);  // ✅ Use base64url
}

function base64urlEncode(str) {
    const base64 = btoa(str);
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
