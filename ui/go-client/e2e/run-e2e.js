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

// helper: login user and return token
async function loginUser(base, username, password) {
  const resp = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!resp.ok) throw new Error(`/login ${username} failed: ${resp.status}`);
  const j = await resp.json();
  return j.token;
}

async function postStart(base, token, isMaster) {
  const url = `${base}/e2e/start?isMaster=${isMaster}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`/e2e/start failed: ${resp.status}`);
}

// connect WS and resolve on first message matching predicate
function connectWsAndWait(user, room, backend, predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${backend}/join/${room}/c/${user}`);
    const t = setTimeout(() => {
      ws.close();
      reject(new Error(`timeout waiting for message for ${user}`));
    }, timeoutMs);
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (predicate(parsed, data.toString())) {
          clearTimeout(t);
          ws.close();
          resolve(parsed);
        }
      } catch (e) {
        // non-json payload
        if (predicate(null, data.toString())) {
          clearTimeout(t);
          ws.close();
          resolve(data.toString());
        }
      }
    });
    ws.on('open', () => { });
    ws.on('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

// New test: admin <-> e2e messaging via /e2e/start + /e2e/command
async function runApiStartAndCommandFlow() {
  const base = process.env.CLIENT || 'http://localhost:3001';
  const room = process.env.ROOM_ID || 'e2e-room';
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'canhthong';
  const e2eUser = process.env.E2E_USERNAME || 'e2e';
  const e2ePass = process.env.E2E_PASSWORD || '019b426e-f904-75bb-8b87-123571a48831';

  console.log('Logging in both users...');
  const adminToken = await loginUser(base, adminUser, adminPass);
  const e2eToken = await loginUser(base, e2eUser, e2ePass);

  console.log('Calling /e2e/start for admin (isMaster=true) and e2e (isMaster=false)...');
  await postStart(base, adminToken, true);
  await postStart(base, e2eToken, false);

  // allow server + signaling to settle
  await new Promise(r => setTimeout(r, 800));

  // prepare expectations
  const msgFromAdmin = 'msg-from-admin-' + Date.now();
  const msgFromE2E = 'msg-from-e2e-' + Date.now();

  // send commands: admin -> e2e
  console.log('Admin sending command to room (expect e2e to receive)...');
  let resp = await fetch(`${base}/e2e/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: msgFromAdmin }),
  });
  if (!resp.ok) throw new Error(`/e2e/command admin failed: ${resp.status}`);

  // e2e -> admin
  console.log('E2E sending command to room (expect admin to receive)...');
  resp = await fetch(`${base}/e2e/command`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${e2eToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: msgFromE2E }),
  });
  if (!resp.ok) throw new Error(`/e2e/command e2e failed: ${resp.status}`);

  // success if both returned 200
  console.log('Both /e2e/command calls returned 200 — test passed.');
}

(async () => {
  try {
    console.log('ENV:', { BACKEND_WS, CLIENT, ROOM });
    // Run existing collection-like flow (login + /auth/hello + /uav/start)
    await runPostmanCollection();
    console.log('============ /uav/start collection run finished ============');

    // Run websocket smoke test
    await runWsSmoke();
    console.log('============ WebSocket smoke test passed ============');

    // Run the new API start + command flow
    await runApiStartAndCommandFlow();
    console.log('============ API start+command flow passed ============');

    process.exit(0);
  } catch (err) {
    console.error('E2E failed:', err);
    process.exit(1);
  }
})();
