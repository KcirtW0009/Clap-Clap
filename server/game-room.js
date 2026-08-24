'use strict';

// V4.0 联机对战房间：服务器权威，基于 GameEngine 的 submitAction/runTurn API
const { Room } = require('colyseus');
const { Schema, MapSchema, defineTypes } = require('@colyseus/schema');
const { GameEngine, normalizeAction } = require('../engine');

const INTERMISSION_MS = Number(process.env.INTERMISSION_MS) || 5000; // 回合间歇（展示战报）
const RECONNECT_MS = Number(process.env.RECONNECT_MS) || 600000;     // 断线重连窗口（不判负，仅保座）
const AUTO_START_MS = 2000;                                          // 满员后自动开局延时

// 回合操作超时分档：<4 人 45s；≥4 人 60s；≥6 人 90s（TURN_TIMEOUT_MS 可强制覆盖，供测试）
function turnTimeoutMs(playerCount) {
  const forced = Number(process.env.TURN_TIMEOUT_MS);
  if (forced > 0) return forced;
  if (playerCount >= 6) return 90000;
  if (playerCount >= 4) return 60000;
  return 45000;
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
    this.hostSessionId = '';
    this.winnerName = '';
    this.players = new MapSchema();
  }
}

defineTypes(RoomState, {
  phase: 'string',
  round: 'uint16',
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
    this.maxClients = 2;
    this.setMetadata({ title: (options && options.title) || '五行拍手对战' });
    this.setState(new RoomState());
    this.engine = null;
    this.turnCount = 0; // 引擎不含回合计数，由房间维护
    this.turnTimer = null; // 操作超时计时器
    this.seatBySession = new Map(); // sessionId -> 座位号
    this.viewBySession = new Map(); // sessionId -> PlayerView
    this.lastReport = null;

    this.onMessage('start', (client) => {
      if (this.state.phase === 'lobby' && client.sessionId === this.state.hostSessionId) {
        this.startGame();
      }
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
    // 对局中不允许旁观/顶替（重连走 allowReconnection 通道）
    if (this.state.phase !== 'lobby') {
      client.leave(4001, '对局进行中，无法加入');
      return;
    }
    const seat = this.viewBySession.size;
    const view = new PlayerView();
    view.sessionId = client.sessionId;
    view.name = String((options && options.name) || ('玩家' + (seat + 1))).slice(0, 12);
    view.seat = seat;
    view.hp = 3;
    this.state.players.set(client.sessionId, view);
    this.state.hostSessionId = this.state.hostSessionId || client.sessionId;
    this.viewBySession.set(client.sessionId, view);
    this.seatBySession.set(client.sessionId, seat);

    client.send('welcome', {
      seat,
      total: this.viewBySession.size,
      isHost: client.sessionId === this.state.hostSessionId,
    });
    this.broadcast('lobby', this.lobbySnapshot());

    if (this.viewBySession.size >= 2) {
      this.clock.setTimeout(() => {
        if (this.state.phase === 'lobby' && this.viewBySession.size >= 2) this.startGame();
      }, AUTO_START_MS);
    }
  }

  onLeave(client, consented) {
    const view = this.viewBySession.get(client.sessionId);
    if (!view) return;

    if (!consented && this.state.phase === 'playing') {
      // 对局中意外断线：保留座位等待重连（不判负）；挂机由回合操作超时兜底
      view.connected = false;
      this.broadcast('system', { text: view.name + ' 连接中断，重连后可继续对战…' });
      this.allowReconnection(client, RECONNECT_MS).then((reconnected) => {
        view.connected = true;
        reconnected.send('welcome', {
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
      });
      return;
    }

    // 大厅离开 / 主动退出：移除座位
    this.state.players.delete(client.sessionId);
    this.viewBySession.delete(client.sessionId);
    this.seatBySession.delete(client.sessionId);
    if (this.state.phase === 'playing') {
      // 已从映射移除，但引擎座位仍按原 seat 判负出局
      this.eliminateAndResolve([view.seat], view.name + ' 主动弃赛，判负出局！');
      return;
    }
    {
      // 重新排座（保持连续编号）
      let i = 0;
      const views = [...this.viewBySession.values()].sort((a, b) => a.seat - b.seat);
      for (const v of views) v.seat = i++;
      this.rebuildSeatMap();
      if (this.viewBySession.size > 0 && !this.viewBySession.has(this.state.hostSessionId)) {
        const first = this.viewBySession.keys().next().value;
        this.state.hostSessionId = first;
      }
      this.broadcast('lobby', this.lobbySnapshot());
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
    for (const [sid, view] of this.viewBySession) {
      this.engine.players[view.seat].name = view.name; // 战报/提示使用玩家昵称
      view.hp = this.engine.players[view.seat].hp;
    }
    this.state.phase = 'playing';
    this.state.round = this.turnCount;
    this.broadcast('started', this.fullSnapshot(null));
    this.startTurnTimer();
  }

  // ---- 回合操作超时：到点未提交者直接判负出局，断线者重连可继续（在时限内提交即可）----

  startTurnTimer() {
    this.clearTurnTimer();
    const ms = turnTimeoutMs(this.viewBySession.size);
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(), ms);
    this.broadcast('turnDeadline', { seconds: Math.ceil(ms / 1000) });
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

    for (const [sid, view] of this.viewBySession) {
      view.hp = this.engine.players[view.seat].hp;
    }
    const report = this.engine.runTurn();
    this.lastReport = report;
    const payload = Object.assign({}, report, {
      round: this.turnCount,
      names: this.engine.players.map(p => p.name),
    });
    this.broadcast('report', payload);

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

  advanceIfReady() {
    if (!this.engine || !this.engine.allActionsSubmitted()) return;
    this.clearTurnTimer();
    const report = this.engine.runTurn();
    this.lastReport = report;
    this.state.round = this.turnCount;

    for (const [, view] of this.viewBySession) {
      view.hp = this.engine.players[view.seat].hp;
    }

    const payload = Object.assign({}, report, {
      round: this.turnCount,
      names: this.engine.players.map(p => p.name),
    });
    this.broadcast('report', payload);

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

  endGame(text) {
    this.clearTurnTimer();
    this.state.phase = 'ended';
    this.state.winnerName = text;
    this.broadcast('ended', { text });
    this.broadcast('sync', this.fullSnapshot(null));
    this.lock(); // 结束后不再接收新连接
  }

  // ---- 快照 ----

  lobbySnapshot() {
    return {
      players: [...this.viewBySession.values()]
        .sort((a, b) => a.seat - b.seat)
        .map(v => ({ name: v.name, seat: v.seat })),
      hostSessionId: this.state.hostSessionId,
    };
  }

  fullSnapshot(forClient) {
    const base = {
      phase: this.state.phase,
      round: this.turnCount,
      winnerText: this.state.winnerName,
      players: this.engine
        ? JSON.parse(JSON.stringify(this.engine.players))
        : [...this.viewBySession.values()].map(v => ({ name: v.name })),
      lastReport: this.lastReport,
    };
    if (forClient) {
      const view = this.viewBySession.get(forClient.sessionId);
      base.you = { seat: view ? view.seat : -1 };
    }
    return base;
  }

  rebuildSeatMap() {
    this.seatBySession.clear();
    for (const [sid, view] of this.viewBySession) {
      this.seatBySession.set(sid, view.seat);
    }
  }
}

module.exports = { GameRoom };
