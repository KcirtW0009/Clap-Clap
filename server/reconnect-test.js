'use strict';

// 断线场景冒烟：对局中断线不判负（座位保留）；挂机方最终由操作超时判负
// 需要服务器以 TURN_TIMEOUT_MS=2500 INTERMISSION_MS=300 启动
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

  const wa = makeWatcher(await clientA.joinOrCreate('clash', { name: '断线侠' }));
  const wb = makeWatcher(await clientB.joinOrCreate('clash', { name: '坚守者' }));
  await Promise.all([wa.wait('welcome', 5000), wb.wait('welcome', 5000)]);
  wa.room.send('start'); // V5.0 房间制：房主手动开局
  await wb.wait('started', 8000);
  console.log('[dc] started');

  // 打完一回合
  wa.room.send('submit', { action: { type: 'gather', element: 'Jin' } });
  wb.room.send('submit', { action: { type: 'gather', element: 'Mu' } });
  await wb.wait('report', 15000);
  console.log('[dc] round 1 resolved');

  // A 意外断线（非主动 leave）
  wa.room.connection.close();
  console.log('[dc] A dropped');
  const sys1 = await wb.wait('system', 6000);
  if (!String(sys1.text).includes('连接中断')) throw new Error('expected drop notice, got: ' + sys1.text);
  console.log('[dc] B notified:', sys1.text);

  // 断线不立即判负：等待超过操作时限前，对局仍在进行（无 ended）
  await sleep(Number(process.env.TURN_TIMEOUT_MS || 2500));
  if (wb.poll('ended')) throw new Error('should not end immediately on disconnect');

  // B 坚守提交；A 断线不再提交 → 超时机制把 A 判负出局 → B 获胜
  wb.room.send('submit', { action: { type: 'defend' } });
  const sys2 = await wb.wait('system', Number(process.env.TURN_TIMEOUT_MS || 2500) + 10000);
  if (!String(sys2.text).includes('操作超时')) throw new Error('expected timeout notice, got: ' + sys2.text);
  console.log('[dc] notice:', sys2.text);
  if (!String(sys2.text).includes('断线侠')) throw new Error('expected 断线侠 to be forfeited');

  const ended = await wb.wait('ended', 15000);
  console.log('[dc] ended:', ended.text);
  if (!String(ended.text).includes('坚守者') || !String(ended.text).includes('获胜')) {
    throw new Error('expected 坚守者 to win, got: ' + ended.text);
  }

  wb.room.leave();
  console.log('[dc] PASS — disconnect keeps seat; turn deadline resolves the match');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[dc] FAIL —', err && err.message);
  process.exit(1);
});
