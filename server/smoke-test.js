'use strict';

// 冒烟测试：两个客户端加入房间 → 自动开局 → 循环提交动作直到分出胜负
const { Client } = require('colyseus.js');

const ENDPOINT = process.env.ENDPOINT || 'ws://localhost:2567';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 消息订阅器：每类消息只注册一次，支持多次 await
const ALL_TYPES = ['welcome', 'lobby', 'started', 'report', 'intermission', 'sync', 'ended', 'system'];
function makeWatcher(room) {
  const queues = new Map();
  const waiters = new Map();
  for (const type of ALL_TYPES) {
    queues.set(type, []);
    waiters.set(type, []);
    room.onMessage(type, (m) => {
      const q = queues.get(type);
      const w = waiters.get(type);
      const resolver = w.shift();
      if (resolver) resolver(m); else q.push(m);
    });
  }
  return {
    next(type, timeoutMs) {
      if (!queues.has(type)) throw new Error('unwatched type: ' + type);
      const q = queues.get(type);
      if (q.length > 0) return Promise.resolve(q.shift());
      return new Promise((res, rej) => {
        const t = timeoutMs ? setTimeout(() => rej(new Error('timeout waiting "' + type + '"')), timeoutMs) : null;
        waiters.get(type).push((m) => { if (t) clearTimeout(t); res(m); });
      });
    },
  };
}

async function main() {
  const clientA = new Client(ENDPOINT);
  const clientB = new Client(ENDPOINT);

  console.log('[smoke] joining room…');
  const roomA = await clientA.joinOrCreate('clash', { name: '甲' });
  const wa = makeWatcher(roomA);
  const welcomeA = await wa.next('welcome', 5000);
  console.log('[smoke] A welcome:', JSON.stringify(welcomeA));

  const roomB = await clientB.joinOrCreate('clash', { name: '乙' });
  const wb = makeWatcher(roomB);
  const welcomeB = await wb.next('welcome', 5000);
  console.log('[smoke] B welcome:', JSON.stringify(welcomeB));

  // 等待满员自动开局
  await wa.next('started', 8000);
  console.log('[smoke] game started');

  let lastReport = null;
  let jinA = 0;
  for (let round = 1; round <= 60; round++) {
    // 双方提交动作（A：攒金猛攻；B：接木不设防，加速分出胜负）
    const act = jinA >= 1
      ? { type: 'use', element: 'Jin', route: 'attack' }
      : { type: 'gather', element: 'Jin' };
    jinA = Math.max(0, jinA + (act.type === 'gather' ? 1 : -1));
    roomA.send('submit', { action: act });
    roomB.send('submit', { action: { type: 'gather', element: 'Mu' } });

    lastReport = await wa.next('report', 15000);
    console.log('[smoke] --- 回合 ' + lastReport.round + ' ---');
    for (const line of String(lastReport.log_message).split('\n')) console.log('    ' + line);
    if (lastReport.winner) break;

    await wa.next('sync', 10000); // 间歇结束后进入下一回合
  }

  if (!lastReport || !lastReport.winner) throw new Error('match did not finish within 60 rounds');
  const ended = await wa.next('ended', 5000);
  console.log('[smoke] ended:', ended.text);

  roomA.leave(); roomB.leave();
  console.log('[smoke] PASS — full match flow works');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[smoke] FAIL —', err && err.message);
  process.exit(1);
});
