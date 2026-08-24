'use strict';

// V5.0 房间制冒烟：创建房间(上限3人) → 观战席 → 房主开局 → 多人提交 → 加特林链路 → 对局中入房自动转观战
// 需要服务器以 INTERMISSION_MS=300 启动
const { Client } = require('colyseus.js');

const ENDPOINT = process.env.ENDPOINT || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeWatcher(room) {
  const queues = new Map();
  for (const type of ['welcome', 'roomInfo', 'started', 'report', 'intermission', 'sync', 'ended', 'system', 'turnDeadline']) {
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
        await sleep(80);
      }
      throw new Error('timeout waiting "' + type + '"');
    },
  };
}

async function main() {
  const clientHost = new Client(ENDPOINT);

  // ---- 创建 3 人上限房间 ----
  const listing = await clientHost.getAvailableRooms('clash');
  console.log('[room] 当前公开房间数:', listing.length);
  const roomA = await clientHost.create('clash', { name: '房主', maxPlayers: 3 });
  const wa = makeWatcher(roomA);
  const wA = await wa.wait('welcome', 5000);
  if (wA.role !== 'player' || !wA.isHost) throw new Error('host welcome malformed: ' + JSON.stringify(wA));
  console.log('[room] 房主就位 seat=' + wA.seat);

  // ---- 玩家 B、C 与观战者加入 ----
  const clientB = new Client(ENDPOINT);
  const clientC = new Client(ENDPOINT);
  const clientS = new Client(ENDPOINT);
  const roomB = await clientB.joinById(roomA.roomId, { name: '快攻手' });
  const wb = makeWatcher(roomB);
  const roomC = await clientC.joinById(roomA.roomId, { name: '铁壁' });
  const wc = makeWatcher(roomC);
  const roomS = await clientS.joinById(roomA.roomId, { name: '围观群众', spectate: true });
  const ws = makeWatcher(roomS);
  const [, , wS] = await Promise.all([
    wb.wait('welcome', 5000),
    wc.wait('welcome', 5000),
    ws.wait('welcome', 5000),
  ]);
  if (!wS || wS.role !== 'spectator') throw new Error('spectator role expected');
  let info = null;
  {
    const end = Date.now() + 6000;
    while (Date.now() < end) {
      const m = wa.poll('roomInfo');
      if (m && m.players.length === 3 && m.spectators.length === 1) { info = m; break; }
      if (!m) await sleep(100);
    }
  }
  if (!info || info.maxPlayers !== 3) throw new Error('roomInfo malformed: ' + JSON.stringify(info));
  console.log('[room] 3 名玩家 + 1 名观众就位');

  // ---- 非房主开局应无效，房主开局生效 ----
  roomC.send('start');
  await sleep(600);
  if (wa.poll('started') || wb.poll('started')) throw new Error('non-host should not start game');
  roomA.send('start');
  const started = await wa.wait('started', 8000);
  if (!Array.isArray(started.players) || started.players.length !== 3) {
    throw new Error('started snapshot malformed');
  }
  const startedS = await ws.wait('started', 5000); // 观战者也收到开局快照
  if (!startedS.players || startedS.players.length !== 3) throw new Error('spectator missed started snapshot');
  console.log('[room] 开局成功，观战端同步');

  // ---- 回合1：A 接金，B 接木，C 防御 ----
  roomA.send('submit', { action: { type: 'gather', element: 'Jin' } });
  roomB.send('submit', { action: { type: 'gather', element: 'Mu' } });
  roomC.send('submit', { action: { type: 'defend' } });
  let rep = await wa.wait('report', 15000);
  await wa.wait('sync', 10000);
  console.log('[room] 回合', rep.round, '结算完成');

  // ---- 回合2：A 铸造加特林（消耗 金1+木1）----
  roomA.send('submit', { action: { type: 'use', element: 'Jin', route: 'craftGatling' } });
  roomB.send('submit', { action: { type: 'gather', element: 'Mu' } });
  roomC.send('submit', { action: { type: 'gather', element: 'Tu' } });
  rep = await wa.wait('report', 15000);
  if (!String(rep.log_message).includes('铸造加特林成功')) throw new Error('craft gatling failed');
  await wa.wait('sync', 10000);

  // ---- 回合3：A 补接金（射击弹药），B/C 防御 ----
  roomA.send('submit', { action: { type: 'gather', element: 'Jin' } });
  roomB.send('submit', { action: { type: 'defend' } });
  roomC.send('submit', { action: { type: 'defend' } });
  rep = await wa.wait('report', 15000);
  await wa.wait('sync', 10000);

  // ---- 回合4：A 加特林射击(1金→2发) → 快攻手；快攻手接木不设防 ----
  roomA.send('submit', { action: { type: 'use', element: 'Jin', route: 'gatlingFire', amount: 1, targets: [1] } });
  roomB.send('submit', { action: { type: 'gather', element: 'Mu' } });
  roomC.send('submit', { action: { type: 'defend' } });
  rep = await wa.wait('report', 15000);
  const logText = String(rep.log_message);
  if (!logText.includes('加特林射击')) throw new Error('gatling fire missing in log: ' + logText);
  const victim = rep.players[1];
  if (victim.hp !== 1) throw new Error('expected 快攻手 hp=1 after 2 bullets, got ' + victim.hp);
  console.log('[room] 加特林链路 OK：2 发子弹命中，hp 3→1');

  // ---- 观战者持续收到战报 ----
  let sRep = null;
  {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const m = ws.poll('report');
      if (m && String(m.log_message).includes('加特林射击')) { sRep = m; break; }
      if (!m) await sleep(100);
    }
  }
  if (!sRep) throw new Error('spectator missed gatling report');

  // ---- 对局中第 4 人尝试入座 → 自动转为观战 ----
  const clientD = new Client(ENDPOINT);
  const roomD = await clientD.joinById(roomA.roomId, { name: '迟到者' });
  const wd = makeWatcher(roomD);
  const wD = await wd.wait('welcome', 5000);
  if (wD.role !== 'spectator' || wD.seat !== -1) {
    throw new Error('mid-game joiner should be spectator, got ' + JSON.stringify(wD));
  }
  console.log('[room] 对局中入房自动转观战 OK');

  roomA.leave(); roomB.leave(); roomC.leave(); roomS.leave(); roomD.leave();
  console.log('[room] PASS — room system + spectator + gatling all work');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('[room] FAIL —', err && err.message);
  process.exit(1);
});
