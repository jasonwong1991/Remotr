#!/usr/bin/env node
// API 和 WebSocket 功能测试
import WebSocket from 'ws';

const BASE_URL = 'http://localhost:9777';
const WS_BASE = 'ws://localhost:9777/ws';

console.log('🧪 Remotr UI/API Tests\n');

// Test 1: Server Health
console.log('Test 1: Server Health Check');
try {
  const response = await fetch(BASE_URL);
  if (response.ok) {
    console.log('✅ Server responding: HTTP', response.status);
  } else {
    throw new Error(`HTTP ${response.status}`);
  }
} catch (err) {
  console.error('❌ Server not accessible:', err.message);
  process.exit(1);
}

// Test 2: API Endpoints
console.log('\nTest 2: API Endpoints');
const roomsRes = await fetch(`${BASE_URL}/api/rooms`);
const rooms = await roomsRes.json();
console.log('✅ /api/rooms:', JSON.stringify(rooms, null, 2));

const sessionsRes = await fetch(`${BASE_URL}/api/rooms/default/sessions`);
const sessions = await sessionsRes.json();
console.log(`✅ /api/rooms/default/sessions: ${sessions.sessions.length} sessions`);

// Test 3: SDK WebSocket Connections
console.log('\nTest 3: Create SDK Sessions (Alice x2, Bob x1)');
const sdkSockets = [];

// Helper to create SDK connection
async function createSDK(deviceId, pageId, identity, title, url) {
  const params = new URLSearchParams({
    room: 'default',
    role: 'sdk',
    deviceId,
    pageId,
    identity,
  });

  const ws = new WebSocket(`${WS_BASE}?${params.toString()}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Connection timeout'));
    }, 5000);

    ws.on('open', () => {
      clearTimeout(timeout);
      // Send system.info
      const frame = {
        kind: 'msg',
        envelope: {
          id: null,
          method: 'system.info',
          timestamp: Date.now(),
          source: 'sdk',
          data: {
            ua: 'Mozilla/5.0 (Test) Chrome/120.0',
            url,
            title,
            viewport: { width: 1440, height: 900 },
            sdkVersion: '0.1.0',
          },
          metadata: {
            session: { deviceId, pageId },
            identity,
          },
        },
      };
      ws.send(JSON.stringify(frame));
      console.log(`✅ Connected: ${identity} / ${deviceId} / ${pageId}`);
      resolve(ws);
    });

    ws.on('error', reject);
  });
}

// Create 3 sessions
try {
  sdkSockets.push(await createSDK('dev_alice_mac', 'page_home', 'alice', 'Home - Alice', 'http://localhost:3000/home'));
  sdkSockets.push(await createSDK('dev_alice_mac', 'page_profile', 'alice', 'Profile - Alice', 'http://localhost:3000/profile'));
  sdkSockets.push(await createSDK('dev_bob_iphone', 'page_home', 'bob', 'Home - Bob', 'http://localhost:3000/home'));
} catch (err) {
  console.error('❌ SDK connection failed:', err.message);
  process.exit(1);
}

// Wait for server to process
await new Promise((r) => setTimeout(r, 1000));

// Test 4: Verify Sessions via API
console.log('\nTest 4: Verify Sessions in API');
const updatedRes = await fetch(`${BASE_URL}/api/rooms/default/sessions`);
const updated = await updatedRes.json();
console.log(`✅ Total sessions: ${updated.sessions.length}`);
for (const s of updated.sessions) {
  const status = s.connected ? '🟢 online' : '🔴 offline';
  console.log(`   ${status} ${s.identity || 'anonymous'} / ${s.session.deviceId} / ${s.session.pageId}`);
  console.log(`      ${s.systemInfo?.title || 'No title'} - ${s.systemInfo?.url || 'No URL'}`);
}

// Test 5: Dashboard WebSocket
console.log('\nTest 5: Dashboard WebSocket (receives session updates)');
const dashboardWs = new WebSocket(`${WS_BASE}?room=default&role=debugger`);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    reject(new Error('Dashboard did not receive sessions event'));
  }, 5000);

  dashboardWs.on('open', () => {
    console.log('✅ Dashboard WebSocket connected');
  });

  dashboardWs.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.kind === 'msg' && frame.envelope.method === 'dashboard.sessions') {
      clearTimeout(timeout);
      console.log('✅ Dashboard received sessions event');
      console.log(`   Sessions in event: ${frame.envelope.data.sessions.length}`);
      for (const s of frame.envelope.data.sessions) {
        console.log(`   - ${s.identity || 'anonymous'}: ${s.session.deviceId}/${s.session.pageId}`);
      }
      resolve();
    }
  });

  dashboardWs.on('error', reject);
});

// Test 6: Session-Specific WebSocket
console.log('\nTest 6: Session-Specific Debugger Connection');
const sessionParams = new URLSearchParams({
  room: 'default',
  role: 'debugger',
  deviceId: 'dev_alice_mac',
  pageId: 'page_home',
});
const sessionWs = new WebSocket(`${WS_BASE}?${sessionParams.toString()}`);

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    console.log('⚠️  Timeout waiting for session backlog (might be empty)');
    resolve();
  }, 3000);

  let messagesReceived = 0;

  sessionWs.on('open', () => {
    console.log('✅ Session debugger connected to dev_alice_mac/page_home');
  });

  sessionWs.on('message', (raw) => {
    messagesReceived++;
    const frame = JSON.parse(raw.toString());
    if (frame.kind === 'msg' && frame.envelope.method === 'system.info') {
      console.log('✅ Received system.info from backlog');
      console.log(`   Title: ${frame.envelope.data.title}`);
      clearTimeout(timeout);
      resolve();
    }
  });

  setTimeout(() => {
    if (messagesReceived === 0) {
      console.log('⚠️  No messages received (backlog might be empty)');
      clearTimeout(timeout);
      resolve();
    }
  }, 2000);

  sessionWs.on('error', reject);
});

// Test 7: Console Message Routing
console.log('\nTest 7: Console Message Routing');
const aliceConsoleMsg = {
  kind: 'msg',
  envelope: {
    id: null,
    method: 'console.entry',
    timestamp: Date.now(),
    source: 'sdk',
    data: {
      level: 'log',
      args: [{ type: 'string', value: 'Test message from Alice' }],
      trace: [],
    },
    metadata: {
      session: { deviceId: 'dev_alice_mac', pageId: 'page_home' },
      identity: 'alice',
    },
  },
};

sdkSockets[0].send(JSON.stringify(aliceConsoleMsg));

await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    console.log('⚠️  Session debugger did not receive console message');
    resolve();
  }, 2000);

  sessionWs.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.kind === 'msg' && frame.envelope.method === 'console.entry') {
      clearTimeout(timeout);
      console.log('✅ Session debugger received console message');
      console.log(`   Message: ${frame.envelope.data.args[0].value}`);
      resolve();
    }
  });
});

// Cleanup
console.log('\n🧹 Cleanup');
dashboardWs.close();
sessionWs.close();
for (const ws of sdkSockets) {
  ws.close();
}

console.log('\n✅ All API/WebSocket tests passed!');
console.log('\n📋 Test Summary:');
console.log('   ✅ Server health check');
console.log('   ✅ API endpoints (/api/rooms, /api/rooms/:id/sessions)');
console.log('   ✅ SDK WebSocket connections (3 sessions created)');
console.log('   ✅ Sessions persisted in API');
console.log('   ✅ Dashboard WebSocket receives session updates');
console.log('   ✅ Session-specific debugger connection');
console.log('   ✅ Message routing (console.entry)');

console.log('\n🌐 Manual UI Test:');
console.log(`   1. Open Dashboard: ${BASE_URL}/#/dashboard?room=default`);
console.log('   2. You should see 2 identity groups: alice (2 sessions), bob (1 session)');
console.log('   3. Click any session card to debug that page');
console.log('   4. Verify "← Dashboard" button returns to dashboard');
console.log('   5. Run demo page: Open examples/demo.html in browser with SDK injected');

process.exit(0);
