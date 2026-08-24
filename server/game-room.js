'use strict';

// V5.0 房间制联机房间：服务器权威，基于 GameEngine 的 submitAction/runTurn API
// - 房间由玩家显式创建（可设 2–9 人上限），房主手动开局
// - 支持观战：任何时候都可进房观战（座位满/对局中自动转为观战）
// - 对局结束后房主可"再来一局"（保留座位回到等待室）
const { Room } = require('colyseus');
const { Schema, MapSchema, defineTypes } = require('@colyseus/schema');
const { GameEngine, normalizeAction } = require('../engine');

const INTERMISSION_MS = Number(process.env.INTERMISSION_MS) || 5000; // 回合间歇（展示战报）
const RECONNECT_MS = Number(process.env.RECONNECT_MS) || 600000;     // 断线重连窗口（不判负，仅保座）
const SPECTATOR_CAP = 10;                                            // 观战席上限

// 回合操作超时分档：<4 人 45s；≥4 人 60s；≥6 人 90s（TURN_TIMEOUT_MS 可强制覆盖，供测试）
function turnTimeoutMs(playerCount) {
  const forced = Number(process.env.TURN_TIMEOUT_MS);
  if (forced > 0) return forced;
  if (playerCount >= 6) return 90000;
  if (playerCount >= 4) return 60000;
  return 45000;
}

function clampPlayers(n) {
  return Math.max(2, Math.min(9, Math.floor(Number(n) || 2)));
}

class PlayerView extends Schema {
  constructor() {
    super();
    this.sessionId = '';
    this.name = '';
    this.seat = -1;
    this.connected = true;
    this.hp = 3;
  }
}

class RoomState extends Schema {
  constructor() {
    super();
    this.phase = 'lobby'; // lobby | playing | ended
    this.round = 0;
    this.maxPlayers = 2;
    this.hostSessionId = '';
    this.winnerName = '';
    this.players = new MapSchema();
  }
}

defineTypes(RoomState, {
  phase: 'string',
  round: 'uint16',
  maxPlayers: 'uint8',
  hostSessionId: 'string',
  winnerName: 'string',
  players: { map: PlayerView },
});
defineTypes(PlayerView, {
  sessionId: 'string',
  name: 'string',
  seat: 'int8',
  connected: 'boolean',
  hp: 'float32',
});

class GameRoom extends Room {
  onCreate(options) {
    const maxPlayers = clampPlayers(options && options.maxPlayers);
    this.maxClients = maxPlayers + SPECTATOR_CAP; // 座位 + 观战席
    this.maxPlayers = maxPlayers;
    this.roomTitle = String((options && options.title) || '五行拍手对战').slice(0, 24);
    this.setMetadata(this.buildMeta('等待玩家…'));
    this.setState(new RoomState());
    this.state.maxPlayers = maxPlayers;
    this.engine = null;
    this.turnCount = 0; // 引擎不含回合计数，由房间维护
    this.turnTimer = null; // 操作超时计时器
    this.seatBySession = new Map(); // sessionId -> 座位号
    this.viewBySession = new Map(); // sessionId -> PlayerView
    this.specBySession = new Map(); // sessionId -> { name }
    this.lastReport = null;

    this.onMessage('start', (client) => {
      if (this.state.phase === 'lobby' && client.sessionId === this.state.hostSessionId &&
        this.viewBySession.size >= 2) {
        this.startGame();
      }
    });

    this.onMessage('rematch', (client) => {
      if (this.state.phase !== 'ended' || client.sessionId !== this.state.hostSessionId) return;
      this.backToLobby();
    });

    this.onMessage('submit', (client, message) => {
      if (this.state.phase !== 'playing' || !this.engine) return;
      const seat = this.seatBySession.get(client.sessionId);
      if (seat === undefined || this.engine.players[seat].hp <= 0) return;
      try {
        this.engine.submitAction(seat, normalizeAction((message && message.action) || {}));
      } catch (err) {
        this.engine.submitAction(seat, { type: 'defend' }); // 非法动作兜底为防御
      }
      this.advanceIfReady();
    });

    this.onMessage('emote', () => { /* 预留：表情/快捷喊话 */ });
  }

  onJoin(client, options) {
    const wantsSeat = !(options && options.spectate);
    const seatFull = this.viewBySession.size >= this.state.maxPlayers;
    // 有空闲座位且在大厅 → 入座；否则一律观战（对局中/座位满/主动观战）
    if (wantsSeat && this.state.phase === 'lobby' && !seatFull) {
      this.joinAsPlayer(client, options);
    } else {
      this.joinAsSpectator(client, options);
    }
  }

  joinAsPlayer(client, options) {
    const seat = this.nextSeat();
    const view = new PlayerView();
    view.sessionId = client.sessionId;
    view.name = this.uniqueName(String((options && options.name) || ('玩家' + (seat + 1))).slice(0, 12));
    view.seat = seat;
    view.hp = 3;
    this.state.players.set(client.sessionId, view);
    this.state.hostSessionId = this.state.hostSessionId || client.sessionId;
    this.viewBySession.set(client.sessionId, view);
    this.seatBySession.set(client.sessionId, seat);

    client.send('welcome', {
      role: 'player',
      seat,
      total: this.viewBySession.size,
      isHost: client.sessionId === this.state.hostSessionId,
    });
    this.broadcastRoomInfo();
    this.refreshMeta();
  }

  joinAsSpectator(client, options) {
    this.specBySession.set(client.sessionId, {
      name: String((options && options.name) || '观众').slice(0, 12),
    });
    client.send('welcome', { role: 'spectator', seat: -1, total: this.viewBySession.size });
    client.send('roomInfo', this.roomInfo());
    if (this.engine) {
      // 对局中/已结束：直接补发完整快照，观战端立即渲染
      client.send('started', Object.assign({}, this.fullSnapshot(null), { resumed: false }));
      if (this.lastReport) client.send('report', this.reportPayload());
      if (this.state.phase === 'playing') {
        client.send('turnDeadline', { seconds: this.turnDeadlineSeconds() });
      }
    }
    this.broadcast('system', {
      text: this.specBySession.get(client.sessionId).name + ' 进入观战',
    });
    this.broadcastRoomInfo();
    this.refreshMeta();
  }

  onLeave(client, consented) {
    const view = this.viewBySession.get(client.sessionId);
    if (!view) {
      if (this.specBySession.delete(client.sessionId)) this.broadcastRoomInfo();
      return;
    }

    if (!consented && this.state.phase === 'playing') {
      // 对局中意外断线：保留座位等待重连（不判负）；挂机由回合操作超时兜底
      view.connected = false;
      this.broadcast('system', { text: view.name + ' 连接中断，重连后可继续对战…' });
      this.allowReconnection(client, RECONNECT_MS).then((reconnected) => {
        view.connected = true;
        reconnected.send('welcome', {
          role: 'player',
          seat: view.seat,
          total: this.viewBySession.size,
          isHost: reconnected.sessionId === this.state.hostSessionId,
          resumed: true,
        });
        reconnected.send('sync', this.fullSnapshot(reconnected));
        this.broadcast('system', { text: view.name + ' 重新连接！' });
      }).catch(() => {
        // 重连窗口到期：仅标记离线，不判负（操作超时会处理长期挂机者）
        console.log('[room] reconnect window expired, sid=' + client.sessionId);
        view.connected = false;
        this.broadcastRoomInfo();
      });
      return;
    }

    // 大厅离开 / 观众离开 / 主动退出对局
    this.state.players.delete(client.sessionId);
    this.viewBySession.delete(client.sessionId);
    this.seatBySession.delete(client.sessionId);
    if (this.state.phase === 'playing') {
      // 已从映射移除，但引擎座位仍按原 seat 判负出局
      this.eliminateAndResolve([view.seat], view.name + ' 主动弃赛，判负出局！');
      return;
    }
    {
      // 大厅内离场：重新排座（保持连续编号）+ 房主继承
      let i = 0;
      const views = [...this.viewBySession.values()].sort((a, b) => a.seat - b.seat);
      for (const v of views) v.seat = i++;
      this.rebuildSeatMap();
      if (this.viewBySession.size > 0 && !this.viewBySession.has(this.state.hostSessionId)) {
        const first = this.viewBySession.keys().next().value;
        this.state.hostSessionId = first;
      }
      this.broadcastRoomInfo();
      this.refreshMeta();
    }
  }

  onDispose() {
    // 引擎无定时器需要清理；clock 由 colyseus 托管
  }

  // ---- 对局流程 ----

  startGame() {
    if (this.state.phase !== 'lobby' || this.viewBySession.size < 2) return;
    this.engine = new GameEngine(this.viewBySession.size);
    this.turnCount = 1;
    for (const [, view] of this.viewBySession) {
      this.engine.players[view.seat].name = view.name; // 战报/提示使用玩家昵称
      view.hp = this.engine.players[view.seat].hp;
    }
    this.state.phase = 'playing';
    this.state.winnerName = '';
    this.state.round = this.turnCount;
    this.broadcast('started', this.fullSnapshot(null));
    this.startTurnTimer();
    this.refreshMeta();
  }

  backToLobby() {
    this.clearTurnTimer();
    this.engine = null;
    this.turnCount = 0;
    this.lastReport = null;
    this.state.phase = 'lobby';
    this.state.round = 0;
    this.state.winnerName = '';
    for (const [, view] of this.viewBySession) view.hp = 3;
    this.broadcast('system', '房主发起再战，回到等待室…');
    this.broadcastRoomInfo();
    this.refreshMeta();
  }

  // ---- 回合操作超时：到点未提交者直接判负出局，断线者重连可继续（在时限内提交即可）----

  startTurnTimer() {
    this.clearTurnTimer();
    const ms = turnTimeoutMs(this.viewBySession.size);
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(), ms);
    this.broadcast('turnDeadline', { seconds: Math.ceil(ms / 1000) });
  }

  turnDeadlineSeconds() {
    const ms = turnTimeoutMs(this.viewBySession.size);
    return Math.ceil(ms / 1000);
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      this.turnTimer.clear();
      this.turnTimer = null;
    }
  }

  onTurnTimeout() {
    if (this.state.phase !== 'playing' || !this.engine) return;
    // 本回合未提交动作的存活玩家 → 判负出局，其余补防御后正常结算
    const timedOut = [];
    for (let seat = 0; seat < this.engine.playerCount; seat++) {
      if (this.engine.players[seat].hp > 0 && !this.engine.hasSubmitted(seat)) {
        timedOut.push(seat);
      }
    }
    if (timedOut.length === 0) return;
    this.eliminateAndResolve(
      timedOut,
      timedOut.map(s => this.engine.players[s].name).join('、') + ' 操作超时，被判负出局！'
    );
  }

  // 将指定座位判负出局（hp 归零、补防御）并立即结算本回合；若仍无人获胜则进入下一回合
  eliminateAndResolve(seats, systemText) {
    if (this.state.phase !== 'playing' || !this.engine) return;
    for (const seat of seats) {
      if (this.engine.players[seat] && this.engine.players[seat].hp > 0) {
        this.engine.players[seat].hp = 0;
        this.engine.submitAction(seat, { type: 'defend' });
      }
    }
    this.broadcast('system', { text: systemText });
    this.resolveAndContinue();
  }

  advanceIfReady() {
    if (!this.engine || !this.engine.allActionsSubmitted()) return;
    this.clearTurnTimer();
    this.resolveAndContinue();
  }

  resolveAndContinue() {
    if (!this.engine) return;
    const report = this.engine.runTurn();
    this.lastReport = report;
    this.state.round = this.turnCount;

    for (const [, view] of this.viewBySession) {
      view.hp = this.engine.players[view.seat].hp;
    }

    this.broadcast('report', this.reportPayload());

    const winner = this.engine.getWinner();
    if (winner) {
      this.endGame(winner === '平局' ? '平局！' : winner + ' 获胜！');
      return;
    }

    this.broadcast('intermission', { seconds: Math.ceil(INTERMISSION_MS / 1000) });
    this.clock.setTimeout(() => {
      if (this.state.phase !== 'playing' || !this.engine) return;
      this.engine.nextRound();
      this.turnCount += 1;
      this.state.round = this.turnCount;
      this.broadcast('sync', this.fullSnapshot(null));
      this.startTurnTimer();
    }, INTERMISSION_MS);
  }

  reportPayload() {
    return Object.assign({}, this.lastReport, {
      round: this.turnCount,
      names: this.engine ? this.engine.players.map(p => p.name) : [],
    });
  }

  endGame(text) {
    this.clearTurnTimer();
    this.state.phase = 'ended';
    this.state.winnerName = text;
    this.broadcast('ended', { text, canRematch: true });
    this.broadcast('sync', this.fullSnapshot(null));
    this.refreshMeta();
  }

  // ---- 快照与广播 ----

  roomInfo() {
    const players = [...this.viewBySession.values()]
      .sort((a, b) => a.seat - b.seat)
      .map(v => ({
        name: v.name,
        seat: v.seat,
        connected: v.connected,
        isHost: v.sessionId === this.state.hostSessionId,
      }));
    return {
      phase: this.state.phase,
      round: this.turnCount,
      maxPlayers: this.state.maxPlayers,
      hostSessionId: this.state.hostSessionId,
      players,
      spectators: [...this.specBySession.values()].map(s => s.name),
    };
  }

  broadcastRoomInfo() {
    this.broadcast('roomInfo', this.roomInfo());
  }

  buildMeta(statusText) {
    return {
      title: this.roomTitle,
      status: statusText || '',
      phase: this.state ? this.state.phase : 'lobby',
      players: this.viewBySession ? this.viewBySession.size : 0,
      maxPlayers: this.maxPlayers,
      spectators: this.specBySession ? this.specBySession.size : 0,
      hostName: this.hostName(),
    };
  }

  hostName() {
    if (!this.state || !this.viewBySession) return '';
    if (!this.viewBySession.has(this.state.hostSessionId)) return '';
    return this.viewBySession.get(this.state.hostSessionId).name;
  }

  refreshMeta() {
    const phase = this.state.phase;
    let status = '等待玩家 ' + this.viewBySession.size + '/' + this.state.maxPlayers;
    if (phase === 'playing') status = '对战中 · 回合 ' + this.turnCount;
    else if (phase === 'ended') status = '已结束 · ' + this.state.winnerName;
    this.setMetadata(this.buildMeta(status));
  }

  fullSnapshot(forClient) {
    const base = {
      phase: this.state.phase,
      round: this.turnCount,
      winnerText: this.state.winnerName,
      players: this.engine
        ? JSON.parse(JSON.stringify(this.engine.players))
        : [...this.viewBySession.values()]
          .sort((a, b) => a.seat - b.seat)
          .map(v => ({ id: v.seat, name: v.name })),
      lastReport: this.lastReport,
      names: this.engine ? this.engine.players.map(p => p.name) :
        [...this.viewBySession.values()].sort((a, b) => a.seat - b.seat).map(v => v.name),
    };
    if (forClient) {
      const view = this.viewBySession.get(forClient.sessionId);
      base.you = {
        seat: view ? view.seat : -1,
        role: view ? 'player' : 'spectator',
      };
    }
    return base;
  }

  nextSeat() {
    let i = 0;
    const views = [...this.viewBySession.values()].sort((a, b) => a.seat - b.seat);
    for (const v of views) {
      if (v.seat !== i) break;
      i++;
    }
    return i;
  }

  uniqueName(base) {
    const taken = new Set([...this.viewBySession.values()].map(v => v.name));
    if (!taken.has(base)) return base;
    let k = 2;
    while (taken.has(base + k)) k++;
    return base + k;
  }

  rebuildSeatMap() {
    this.seatBySession.clear();
    for (const [sid, view] of this.viewBySession) {
      this.seatBySession.set(sid, view.seat);
    }
  }
}

module.exports = { GameRoom };
