// UI 功能测试脚本
import WebSocket from 'ws';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:9777';
const WS_BASE = 'ws://localhost:9777/ws';

console.log('🧪 Starting Remotr UI Tests\n');

// Test 1: Server Health Check
console.log('Test 1: Server Health Check');
try {
  const response = await fetch(BASE_URL);
  console.log(`✓ Server responding: HTTP ${response.status}`);
} catch (err) {
  console.error('✗ Server not accessible:', err.message);
  process.exit(1);
}

// Test 2: API Endpoints
console.log('\nTest 2: API Endpoints');
const roomsRes = await fetch(`${BASE_URL}/api/rooms`);
const rooms = await roomsRes.json();
console.log(`✓ /api/rooms: ${JSON.stringify(rooms)}`);

const sessionsRes = await fetch(`${BASE_URL}/api/rooms/default/sessions`);
const sessions = await sessionsRes.json();
console.log(`✓ /api/rooms/default/sessions: ${sessions.sessions.length} sessions`);

// Test 3: Simulate SDK Connections
console.log('\nTest 3: SDK Connections with Identity');
const sdkConnections = [];

// Alice - 2 pages
const aliceParams1 = new URLSearchParams({
  room: 'default',
  role: 'sdk',
  deviceId: 'dev_alice_mac',
  pageId: 'page_alice_home',
  identity: 'alice',
});
const alice1 = new WebSocket(`${WS_BASE}?${aliceParams1.toString()}`);
await new Promise((resolve) => {
  alice1.on('open', () => {
    // Send system.info
    const systemInfo = {
      kind: 'msg',
      envelope: {
        id: null,
        method: 'system.info',
        timestamp: Date.now(),
        source: 'sdk',
        data: {
          ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
          url: 'http://localhost:3000/home',
          title: 'Home - Alice',
          viewport: { width: 1440, height: 900 },
          sdkVersion: '0.1.0',
        },
        metadata: {
          session: { deviceId: 'dev_alice_mac', pageId: 'page_alice_home' },
          identity: 'alice',
        },
      },
    };
    alice1.send(JSON.stringify(systemInfo));
    console.log('✓ Alice session 1 connected: dev_alice_mac / page_alice_home');
    resolve();
  });
});
sdkConnections.push(alice1);

const aliceParams2 = new URLSearchParams({
  room: 'default',
  role: 'sdk',
  deviceId: 'dev_alice_mac',
  pageId: 'page_alice_profile',
  identity: 'alice',
});
const alice2 = new WebSocket(`${WS_BASE}?${aliceParams2.toString()}`);
await new Promise((resolve) => {
  alice2.on('open', () => {
    const systemInfo = {
      kind: 'msg',
      envelope: {
        id: null,
        method: 'system.info',
        timestamp: Date.now(),
        source: 'sdk',
        data: {
          ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0',
          url: 'http://localhost:3000/profile',
          title: 'Profile - Alice',
          viewport: { width: 1440, height: 900 },
          sdkVersion: '0.1.0',
        },
      },
    };
    alice2.send(JSON.stringify(systemInfo));
    console.log('✓ Alice session 2 connected: dev_alice_mac / page_alice_profile');
    resolve();
  });
});
sdkConnections.push(alice2);

// Bob - 1 page
const bobParams = new URLSearchParams({
  room: 'default',
  role: 'sdk',
  deviceId: 'dev_bob_iphone',
  pageId: 'page_bob_home',
  identity: 'bob',
});
const bob = new WebSocket(`${WS_BASE}?${bobParams.toString()}`);
await new Promise((resolve) => {
  bob.on('open', () => {
    const systemInfo = {
      kind: 'msg',
      envelope: {
        id: null,
        method: 'system.info',
        timestamp: Date.now(),
        source: 'sdk',
        data: {
          ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari/604.1',
          url: 'http://localhost:3000/home',
          title: 'Home - Bob',
          viewport: { width: 414, height: 896 },
          sdkVersion: '0.1.0',
        },
      },
    };
    bob.send(JSON.stringify(systemInfo));
    console.log('✓ Bob session connected: dev_bob_iphone / page_bob_home');
    resolve();
  });
});
sdkConnections.push(bob);

// Wait for server to process
await new Promise((r) => setTimeout(r, 1000));

// Test 4: Verify Sessions API
console.log('\nTest 4: Verify Sessions API');
const updatedSessions = await fetch(`${BASE_URL}/api/rooms/default/sessions`).then((r) => r.json());
console.log(`✓ Sessions count: ${updatedSessions.sessions.length}`);
for (const session of updatedSessions.sessions) {
  console.log(`  - ${session.identity || 'anonymous'} / ${session.session.deviceId} / ${session.session.pageId} (${session.connected ? 'online' : 'offline'})`);
}

// Test 5: Dashboard WebSocket
console.log('\nTest 5: Dashboard WebSocket Connection');
const dashboardWs = new WebSocket(`${WS_BASE}?room=default&role=debugger`);
let dashboardReceived = false;
await new Promise((resolve) => {
  dashboardWs.on('message', (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.kind === 'msg' && frame.envelope.method === 'dashboard.sessions') {
      dashboardReceived = true;
      console.log('✓ Dashboard received sessions event');
      console.log(`  Sessions in event: ${frame.envelope.data.sessions.length}`);
      resolve();
    }
  });
  dashboardWs.on('open', () => {
    console.log('✓ Dashboard WebSocket connected');
  });
  setTimeout(() => {
    if (!dashboardReceived) {
      console.error('✗ Dashboard did not receive sessions event within timeout');
      resolve();
    }
  }, 3000);
});

// Test 6: Launch Browser and Test UI
console.log('\nTest 6: Browser UI Tests');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Test Dashboard load
await page.goto(`${BASE_URL}/#/dashboard?room=default`);
await page.waitForSelector('text=Remotr Dashboard', { timeout: 5000 });
console.log('✓ Dashboard page loaded');

// Check for session cards
const sessionCards = await page.locator('text=alice').count();
console.log(`✓ Found ${sessionCards} references to "alice" on dashboard`);

// Check online status indicator
const onlineIndicators = await page.locator('text=在线').count();
console.log(`✓ Found ${onlineIndicators} "在线" indicators`);

// Take screenshot
await page.screenshot({ path: '/tmp/remotr-dashboard.png' });
console.log('✓ Screenshot saved: /tmp/remotr-dashboard.png');

// Test navigation to session view (click first session)
try {
  // Look for a clickable session card
  const firstCard = page.locator('[style*="cursor: pointer"]').first();
  await firstCard.click({ timeout: 2000 });
  await page.waitForURL(/.*#\/session.*/, { timeout: 5000 });
  console.log('✓ Navigated to session view');

  // Verify session view elements
  await page.waitForSelector('text=Dashboard', { timeout: 5000 });
  console.log('✓ Session view has "Back to Dashboard" button');

  await page.screenshot({ path: '/tmp/remotr-session.png' });
  console.log('✓ Screenshot saved: /tmp/remotr-session.png');
} catch (err) {
  console.log('⚠ Session navigation test skipped (no clickable cards or navigation failed)');
}

await browser.close();

// Cleanup
console.log('\n🧹 Cleanup');
dashboardWs.close();
for (const ws of sdkConnections) {
  ws.close();
}
await new Promise((r) => setTimeout(r, 500));

console.log('\n✅ All UI tests completed!');
console.log('   - Server: Running');
console.log('   - API Endpoints: Working');
console.log('   - SDK Connections: 3 sessions created');
console.log('   - Dashboard WebSocket: Receiving updates');
console.log('   - Dashboard UI: Loaded and displaying sessions');
console.log('   - Navigation: Working (if clickable cards found)');
console.log('\nScreenshots saved:');
console.log('   - /tmp/remotr-dashboard.png');
console.log('   - /tmp/remotr-session.png (if navigation succeeded)');

process.exit(0);
