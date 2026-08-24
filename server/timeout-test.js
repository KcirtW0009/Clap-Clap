'use strict';

// 操作超时冒烟：一方不提交动作 → 到点被判负出局 → 对手获胜
// 需要服务器以 TURN_TIMEOUT_MS=2000 INTERMISSION_MS=300 启动
const { Client } = require('colyseus.js');

const ENDPOINT = process.env.ENDPOINT || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWatcher(room) {
  const queues = new Map();
  for (const type of ['welcome', 'lobby', 'started', 'report', 'intermission', 'sync', 'ended', 'system', 'turnDeadline']) {
    queues.set(type, []);
    room.onMessage(type, m => queues.get(type).push(m));
  }
  return {
    room,
    poll(type) { return queues.get(type).shift() || null; },
    async wait(type, timeoutMs) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const m = this.poll(type);
        if (m) return m;
        await sleep(100);
      }
      throw new Error('timeout waiting "' + type + '"');
    },
  };
}

async function main() {
  const clientA = new Client(ENDPOINT);
  const clientB = new Client(ENDPOINT);

  const wa = makeWatcher(await clientA.joinOrCreate('clash', { name: '手快侠' }));
  const wb = makeWatcher(await clientB.joinOrCreate('clash', { name: '挂机者' }));
  await Promise.all([wa.wait('welcome', 5000), wb.wait('welcome', 5000)]);

  const started = await wa.wait('started', 8000);
  const deadlineMsg = await wa.wait('turnDeadline', 3000);
  console.log('[timeout] started; deadline=' + deadlineMsg.seconds + 's');
  if (deadlineMsg.seconds !== Math.ceil(Number(process.env.TURN_TIMEOUT_MS || 2000) / 1000)) {
    throw new Error('unexpected deadline seconds: ' + deadlineMsg.seconds);
  }

  // 回合1：双方正常提交
  wa.room.send('submit', { action: { type: 'gather', element: 'Jin' } });
  wb.room.send('submit', { action: { type: 'gather', element: 'Mu' } });
  const r1 = await wa.wait('report', 15000);
  console.log('[timeout] round', r1.round, 'ok');
  await wa.wait('sync', 10000);

  // 回合2：B 挂机不提交 → 应被超时判负
  wa.room.send('submit', { action: { type: 'defend' } });
  const sys = await wa.wait('system', Number(process.env.TURN_TIMEOUT_MS || 2000) + 8000);
  if (!String(sys.text).includes('操作超时')) throw new Error('expected timeout notice, got: ' + sys.text);
  console.log('[timeout] notice:', sys.text);

  const ended = await wa.wait('ended', 15000);
  console.log('[timeout] ended:', ended.text);
  if (!String(ended.text).includes('手快侠') || !String(ended.text).includes('获胜')) {
    throw new Error('expected 手快侠 to win, got: ' + ended.text);
  }

  wa.room.leave(); wb.room.leave();
  console.log('[timeout] PASS — idle player forfeited by turn deadline');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[timeout] FAIL —', err && err.message);
  process.exit(1);
});
