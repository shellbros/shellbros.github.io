export async function onRequest(context) {
    const { request, env } = context;
    
    console.log('[Proxy] Request to:', request.url);
    
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
    }

    const clientIP = request.headers.get('CF-Connecting-IP');
    console.log(`[Proxy] Client ${clientIP}`);
    
    // TEST: Use a simple short protocol
    const testProtocol = 'test123';  // Super simple
    
    try {
        const backendUrl = 'wss://dev.shellshock.io/matchmaker';
        console.log(`[Proxy] Connecting with protocol: ${testProtocol}`);
        
        const backendWs = new WebSocket(backendUrl, [testProtocol]);
        
        const connected = await Promise.race([
            new Promise((resolve) => {
                backendWs.addEventListener('open', () => {
                    console.log('[Proxy] ✓ Connected!');
                    resolve(true);
                }, { once: true });
                backendWs.addEventListener('error', (e) => {
                    console.error('[Proxy] ✗ Error:', e);
                    resolve(false);
                }, { once: true });
            }),
            new Promise((resolve) => setTimeout(() => {
                console.log('[Proxy] Timeout');
                resolve(false);
            }, 3000))
        ]);
        
        if (!connected) {
            backendWs.close();
            return new Response('Connection failed', { status: 503 });
        }
        
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        
        backendWs.addEventListener('message', (event) => {
            try { server.send(event.data); } catch (e) {}
        });
        
        server.addEventListener('message', (event) => {
            try {
                if (backendWs.readyState === WebSocket.OPEN) {
                    backendWs.send(event.data);
                }
            } catch (e) {}
        });
        
        backendWs.addEventListener('close', (event) => {
            try { server.close(event.code, event.reason); } catch (e) {}
        });
        
        server.addEventListener('close', (event) => {
            try { backendWs.close(event.code, event.reason); } catch (e) {}
        });
        
        server.accept();
        
        return new Response(null, {
            status: 101,
            webSocket: client,
        });
        
    } catch (error) {
        console.error('[Proxy] Exception:', error.message, error.stack);
        return new Response('Error', { status: 500 });
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
    
    // Use base64url encoding (safe for WebSocket protocols)
    return base64urlEncode(token);
}

function base64urlEncode(str) {
    // Standard base64 encode
    const base64 = btoa(str);
    
    // Convert to base64url by replacing problematic characters
    return base64
        .replace(/\+/g, '-')   // Replace + with -
        .replace(/\//g, '_')   // Replace / with _
        .replace(/=/g, '');    // Remove padding =
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
