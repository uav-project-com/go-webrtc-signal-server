// Ensure `global` exists for modules (undici/newman expect it).
// Use `globalThis` to set `.global` property so we don't reference an undeclared `global` identifier.
if (typeof globalThis.global === 'undefined') {
  globalThis.global = globalThis;
}
// Load environment after ensuring global is present
require('dotenv').config();
const WebSocket = require('ws');

const BACKEND_WS = process.env.BACKEND_WS || 'ws://localhost:8080';
const CLIENT = process.env.CLIENT || 'http://localhost:3001';
const ROOM = process.env.ROOM_ID || 'e2e-room';

async function runPostmanCollection() {
  console.log('Running simplified Postman flow via fetch...');
  const base = process.env.CLIENT || 'http://localhost:3001';
  // 1) POST /login
  const USERNAME = process.env.ADMIN_USERNAME;
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const loginResp = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!loginResp.ok) throw new Error(`/login failed: ${loginResp.status}`);
  const loginJson = await loginResp.json();
  const token = loginJson.token;
  if (!token) throw new Error('login did not return token');

  // 2) GET /auth/hello
  const helloResp = await fetch(`${base}/auth/hello`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!helloResp.ok) throw new Error(`/auth/hello failed: ${helloResp.status}`);

  // 3) POST /uav/start (use returned token)
  const startResp = await fetch(`${base}/uav/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!startResp.ok) throw new Error(`/uav/start failed: ${startResp.status}`);
  return;
}

function wsUrl(user) {
  // WebsocketClient in Go dials: {BASE}/join/{roomId}/c/{userId}
  return `${BACKEND_WS}/join/${ROOM}/c/${user}`;
}

async function runWsSmoke() {
  console.log('Starting WebSocket smoke test...');
  return new Promise((resolve, reject) => {
    const anna = new WebSocket(wsUrl('anna'));
    const bob = new WebSocket(wsUrl('bob'));
    let bobReceived = false;

    const timeout = setTimeout(() => {
      if (!bobReceived) reject(new Error('bob did not receive message within timeout'));
    }, 10000);

    bob.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log('bob got ws message:', msg);
        if (msg.msg === 'hello-from-anna') {
          bobReceived = true;
          clearTimeout(timeout);
          anna.close();
          bob.close();
          resolve();
        }
      } catch (e) {
        // ignore non-json
      }
    });

    let openCount = 0;
    function onOpen() {
      openCount++;
      if (openCount === 2) {
        // send a signaling msg from anna to bob via server
        const signal = {
          channel: 'dt',
          from: 'anna',
          to: 'bob',
          msg: 'hello-from-anna',
          roomId: ROOM
        };
        // small delay to ensure server processed joins
        setTimeout(() => {
          console.log('anna sending message to room...');
          anna.send(JSON.stringify(signal));
        }, 500);
      }
    }

    anna.on('open', onOpen);
    bob.on('open', onOpen);

    anna.on('error', (e) => {
      console.error('anna ws error', e);
    });
    bob.on('error', (e) => {
      console.error('bob ws error', e);
    });
  });
}

(async () => {
  try {
    console.log('ENV:', { BACKEND_WS, CLIENT, ROOM });
    // Run Postman collection first (this may exercise /uav/start)
    await runPostmanCollection();
    console.log('/uav/start collection run finished');

    // Run websocket smoke test
    await runWsSmoke();
    console.log('WebSocket smoke test passed');




    process.exit(0);
  } catch (err) {
    console.error('E2E failed:', err);
    process.exit(1);
  }
})();
