'use strict';

const ACTION = Object.freeze({
  GATHER: 'gather',
  USE: 'use',
  DEFEND: 'defend'
});

const STATE = Object.freeze({
  READY: 'READY',
  LOCK: 'LOCK',
  RESULT: 'RESULT'
});

const ELEMENT = Object.freeze({
  JIN: 'Jin',
  MU: 'Mu',
  SHUI: 'Shui',
  HUO: 'Huo',
  TU: 'Tu'
});

const ELEMENT_LABEL = Object.freeze({
  Jin: '金',
  Mu: '木',
  Shui: '水',
  Huo: '火',
  Tu: '土'
});

const GATHERABLE_ELEMENTS = Object.freeze(['Jin', 'Mu', 'Shui', 'Huo', 'Tu']);

const MAX_ELEMENT = 9;

const MAX_HP = 5;

const MAX_SHELL = 5;

const SELF_ROUTES = Object.freeze({
  'Jin.craftGatling': true,
  'Jin.craftDual': true,
  'Jin.craftAP': true,
  'Mu.thorn': true,
  'Shui.spring': true,
  'Tu.shell': true,
  'Tu.thornRock': true,
  'Tu.vein': true
});

const ROUTES = Object.freeze({
  Jin: Object.freeze({
    attack: { name: '金之斩', cost: 1 },
    craftGatling: { name: '铸造加特林', cost: 1 },
    gatlingFire: { name: '加特林射击', cost: 'amount' },
    craftDual: { name: '铸造双枪', cost: 1 },
    dualFire: { name: '双枪射击', cost: 1 },
    craftAP: { name: '铸造穿甲弹', cost: 1 },
    apFire: { name: '穿甲射击', cost: 'ap' }
  }),
  Mu: Object.freeze({
    attack: { name: '木之刺', cost: 1 },
    bind: { name: '藤蔓束缚', cost: 1 },
    seed: { name: '种子寄生', cost: 2 },
    thorn: { name: '荆棘之墙', cost: 2 }
  }),
  Huo: Object.freeze({
    fireball: { name: '火球术', cost: 1 },
    fireRain: { name: '火球雨', cost: 'all' },
    blaze: { name: '烈焰爆发', cost: 2 },
    burn: { name: '灼烧烙印', cost: 2 }
  }),
  Shui: Object.freeze({
    attack: { name: '水弹', cost: 1 },
    seep: { name: '渗透', cost: 1 },
    scour: { name: '冲刷', cost: 2 },
    spring: { name: '生命之泉', cost: 2 }
  }),
  Tu: Object.freeze({
    attack: { name: '土弹', cost: 1 },
    shell: { name: '岩壳', cost: 1 },
    thornRock: { name: '荆棘岩', cost: 2 },
    vein: { name: '岩脉共鸣', cost: 3 }
  })
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function makePlayer(id, name) {
  return {
    id,
    name,
    hp: 3,
    maxHp: 3,
    elements: { Jin: 0, Mu: 0, Shui: 0, Huo: 0, Tu: 0 },
    weapons: { hasGatling: false, hasDualPistols: false, armorPiercing: 0 },
    status: {
      bindTurns: 0,
      seedTurns: 0,
      seedOwner: -1,
      burnTurns: 0,
      wetTurns: 0,
      shellLayers: 0,
      hasVein: false,
      // ---- V4.0 多人平衡新增：招式免疫期（仅 playerCount >= 3 时会置位）----
      scourImmuneTurns: 0, // 冲刷免疫剩余回合
      seedImmuneTurns: 0,  // 种子寄生免疫剩余回合
      bindImmuneTurns: 0,  // 束缚免疫剩余回合（解除束缚后 1 回合）
      lastAction: null
    }
  };
}

function normalizeAction(action) {
  if (action == null) {
    return { type: ACTION.DEFEND, element: null, route: null, amount: 0, targets: null };
  }
  const type = action.type;
  if (type === ACTION.DEFEND) {
    return { type: ACTION.DEFEND, element: null, route: null, amount: 0, targets: null };
  }
  const element = action.element || null;
  const route = action.route || null;
  const amount = Math.max(0, Number(action.amount) || 0);
  let targets = null;
  if (Array.isArray(action.targets)) {
    targets = action.targets
      .map(v => Math.floor(Number(v)))
      .filter(v => Number.isFinite(v) && v >= 0);
    if (targets.length === 0) targets = null;
  }
  return { type, element, route, amount, targets };
}

function sameTargets(a, b) {
  const ta = Array.isArray(a.targets) ? a.targets : null;
  const tb = Array.isArray(b.targets) ? b.targets : null;
  if (ta === null && tb === null) return true;
  if (!ta || !tb || ta.length !== tb.length) return false;
  for (let k = 0; k < ta.length; k++) {
    if (ta[k] !== tb[k]) return false;
  }
  return true;
}

function sameAction(a, b) {
  if (!a || !b) return false;
  return a.type === b.type && a.element === b.element && a.route === b.route &&
    a.amount === b.amount && sameTargets(a, b);
}

function formatAction(action) {
  const a = normalizeAction(action);
  switch (a.type) {
    case ACTION.GATHER:
      return '接取 ' + (ELEMENT_LABEL[a.element] || '?');
    case ACTION.DEFEND:
      return '防御';
    case ACTION.USE: {
      const r = ROUTES[a.element] && ROUTES[a.element][a.route];
      const label = r ? r.name : a.route;
      let s = '使用 ' + (ELEMENT_LABEL[a.element] || '?') + '→' + label;
      if (a.route === 'gatlingFire') s += ' ×' + a.amount;
      return s;
    }
    default:
      return '';
  }
}

class GameEngine {
  constructor(playerCount) {
    const n = Math.max(2, Math.min(9, Math.floor(Number(playerCount) || 2)));
    this.playerCount = n;
    this.INITIAL_HP = 3;
    this.MAX_HP = MAX_HP;
    this.MAX_ELEMENT = MAX_ELEMENT;
    this.MAX_SHELL = MAX_SHELL;
    // V4.0：多人平衡规则开关（≥3 人局启用冲刷/种子/束缚免疫与穿甲强化）
    this.multiRules = n >= 3;
    this.state = STATE.READY;
    this.players = [];
    for (let k = 0; k < n; k++) this.players.push(makePlayer(k, 'P' + (k + 1)));
    this.currentActions = new Array(n).fill(null);
    this._wall = new Array(n).fill(false);
    this._thornRock = new Array(n).fill(false);
    this._noReflect = new Array(n).fill(false); // 本回合反伤被穿甲弹压制的标记
    this._pendingActions = null;                // submitAction/runTurn API 的暂存区
  }

  reset() {
    this.state = STATE.READY;
    this.currentActions = new Array(this.playerCount).fill(null);
    this._wall = new Array(this.playerCount).fill(false);
    this._thornRock = new Array(this.playerCount).fill(false);
    this._noReflect = new Array(this.playerCount).fill(false);
    this._pendingActions = null;
    this.players = [];
    for (let k = 0; k < this.playerCount; k++) this.players.push(makePlayer(k, 'P' + (k + 1)));
  }

  getState() {
    return {
      state: this.state,
      players: JSON.parse(JSON.stringify(this.players))
    };
  }

  get isGameOver() {
    return this.players.filter(p => p.hp > 0).length <= 1;
  }

  getWinner() {
    const alive = this.players.filter(p => p.hp > 0);
    if (alive.length === 0) return '平局';
    if (alive.length === 1) return alive[0].name;
    return null;
  }

  _aliveOthers(i) {
    const out = [];
    for (let k = 0; k < this.playerCount; k++) {
      if (k !== i && this.players[k].hp > 0) out.push(k);
    }
    return out;
  }

  _defaultTarget(i) {
    const others = this._aliveOthers(i);
    if (others.length > 0) return [others[0]];
    const any = (i + 1) % this.playerCount;
    return [any];
  }

  // 返回校验后的目标下标数组；非法返回 null
  _resolveTargets(i, act) {
    const n = this.playerCount;
    const key = act.element + '.' + act.route;
    let t = Array.isArray(act.targets)
      ? act.targets.filter(v => Number.isInteger(v) && v >= 0 && v < n && v !== i)
      : null;
    if (!t || t.length === 0) t = this._defaultTarget(i).filter(v => v !== i);

    if (key === 'Jin.dualFire') {
      // V4.1：仅剩一名存活对手时（含 1v1），允许两发集火同一目标
      const soloOpponent = this._aliveOthers(i).length === 1;
      if (t.length >= 2) {
        const pair = [t[0], t[1]];
        if (pair[0] !== pair[1]) return pair;
        return soloOpponent ? pair : null; // 多人且对手 ≥2 时必须分流
      }
      return soloOpponent ? this._defaultTarget(i).concat(this._defaultTarget(i)) : null;
    }
    if (key === 'Huo.fireRain') {
      const uniq = new Set(t);
      if (uniq.size !== t.length) return null; // 单一目标只能被指定 1 次
      const huo = this.players[i].elements.Huo;
      if (t.length >= 1 && t.length <= Math.max(1, huo)) return t;
      return null;
    }
    // 单体路线：attack / gatlingFire / apFire / fireball / blaze / burn / bind / seed / Mu.attack
    return [t[0]];
  }

  _targetsValid(i, act) {
    return this._resolveTargets(i, act) !== null;
  }

  // V4.0：动作被招式级规则禁用时的专属战报文案（资源不足仍走通用文案）
  _blockedUseReason(i, act) {
    const P = this.players;
    const r = ROUTES[act.element] && ROUTES[act.element][act.route];
    if (!r) return null;
    if (typeof r.cost === 'number' && P[i].elements[act.element] < r.cost) return null;
    const ts = this._resolveTargets(i, act) || [];
    const hit = pred => ts.some(t => pred(P[t].status));
    if (act.element === ELEMENT.MU && act.route === 'bind') {
      if (hit(s => s.bindTurns > 0)) {
        return ['目标已被束缚，束缚不可叠加', P[i].name + ' 的藤蔓被弹开——目标已被束缚，束缚不可叠加！'];
      }
      if (this.multiRules && hit(s => s.bindImmuneTurns > 0)) {
        return ['目标处于束缚免疫期', P[i].name + ' 的藤蔓无从缠绕——' + P[ts[0]].name + ' 处于束缚免疫期！'];
      }
    }
    if (this.multiRules && act.element === ELEMENT.MU && act.route === 'seed' && hit(s => s.seedImmuneTurns > 0)) {
      return ['目标处于种子免疫期', P[i].name + ' 的种子无法寄生——' + P[ts[0]].name + ' 处于种子免疫期！'];
    }
    if (this.multiRules && act.element === ELEMENT.SHUI && act.route === 'scour' && hit(s => s.scourImmuneTurns > 0)) {
      return ['目标处于冲刷免疫期', P[i].name + ' 的激流无功而返——' + P[ts[0]].name + ' 处于冲刷免疫期！'];
    }
    return null;
  }

  isActionFeasible(idx, action) {
    const a = normalizeAction(action);
    const p = this.players[idx];

    if (a.type === ACTION.DEFEND) return true;

    if (a.type === ACTION.GATHER) {
      return GATHERABLE_ELEMENTS.indexOf(a.element) !== -1;
    }

    if (a.type === ACTION.USE) {
      const routes = ROUTES[a.element];
      if (!routes || !routes[a.route]) return false;
      // ---- V3.1/V4.0 招式目标级禁用：不可叠加与免疫期 ----
      if (a.element === ELEMENT.MU && a.route === 'bind') {
        const ts = this._resolveTargets(idx, a);
        if (!ts || ts.some(t => this.players[t].status.bindTurns > 0)) return false; // 束缚不可叠加
        if (this.multiRules && ts.some(t => this.players[t].status.bindImmuneTurns > 0)) return false; // V4.0 束缚免疫
      }
      if (this.multiRules && a.element === ELEMENT.MU && a.route === 'seed') {
        const ts = this._resolveTargets(idx, a);
        if (ts && ts.some(t => this.players[t].status.seedImmuneTurns > 0)) return false; // V4.0 种子免疫
      }
      if (this.multiRules && a.element === ELEMENT.SHUI && a.route === 'scour') {
        const ts = this._resolveTargets(idx, a);
        if (ts && ts.some(t => this.players[t].status.scourImmuneTurns > 0)) return false; // V4.0 冲刷免疫
      }
      const r = routes[a.route];
      const self = SELF_ROUTES[a.element + '.' + a.route] === true;
      if (r.cost === 'amount') {
        return a.element === ELEMENT.JIN && p.weapons.hasGatling && a.amount >= 1 &&
          p.elements.Jin >= a.amount && this._targetsValid(idx, a);
      }
      if (r.cost === 'all') {
        return p.elements[a.element] >= 1 && this._targetsValid(idx, a);
      }
      if (r.cost === 'ap') {
        return p.weapons.armorPiercing >= 1 && this._targetsValid(idx, a);
      }
      if (typeof r.cost === 'number') {
        if (p.elements[a.element] < r.cost) return false;
        if (a.route === 'craftGatling' && p.weapons.hasGatling) return false;
        if (a.route === 'craftDual' && p.weapons.hasDualPistols) return false;
        if (a.route === 'gatlingFire' && !p.weapons.hasGatling) return false;
        if (a.route === 'dualFire' && !p.weapons.hasDualPistols) return false;
        return self || this._targetsValid(idx, a);
      }
    }

    return false;
  }

  getAvailableRoutes(idx, element) {
    const routes = ROUTES[element];
    if (!routes) return [];
    const p = this.players[idx];
    return Object.keys(routes).filter(route => {
      const r = routes[route];
      if (r.cost === 'amount') {
        return p.weapons.hasGatling && p.elements[element] >= 1;
      }
      // V4.1：双枪在多人局需显式分流目标，未带目标时按武器+资源判断可用性（由 UI 补目标流程）
      if (route === 'dualFire') {
        return p.weapons.hasDualPistols && p.elements.Jin >= (typeof r.cost === 'number' ? r.cost : 1);
      }
      return this.isActionFeasible(idx, { type: ACTION.USE, element, route });
    });
  }

  formatAction(action) {
    return formatAction(action);
  }

  executeRound(...args) {
    let list = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    const actsIn = [];
    for (let k = 0; k < this.playerCount; k++) {
      actsIn.push(list[k] !== undefined ? list[k] : { type: ACTION.DEFEND });
    }
    this.state = STATE.LOCK;
    this.currentActions = actsIn;
    const report = this.resolveActions(actsIn);
    this.state = STATE.RESULT;
    return report;
  }

  // ---- V4.0 联机 API：按座位号逐个提交动作，凑齐后 runTurn 统一结算 ----
  submitAction(seatIdx, action) {
    if (!this._pendingActions) this._pendingActions = new Array(this.playerCount).fill(undefined);
    this._pendingActions[Math.floor(Number(seatIdx))] =
      action == null ? { type: ACTION.DEFEND } : normalizeAction(action);
  }

  allActionsSubmitted() {
    if (!this._pendingActions) return false;
    for (let k = 0; k < this.playerCount; k++) {
      if (this.players[k].hp > 0 && !this._pendingActions[k]) return false; // 死亡玩家无需提交
    }
    return true;
  }

  hasSubmitted(seatIdx) {
    return !!(this._pendingActions && this._pendingActions[Math.floor(Number(seatIdx))]);
  }

  runTurn() {
    const pending = this._pendingActions || [];
    this._pendingActions = null;
    return this.executeRound(pending);
  }

  nextRound() {
    this.currentActions = new Array(this.playerCount).fill(null);
    this._wall = new Array(this.playerCount).fill(false);
    this._thornRock = new Array(this.playerCount).fill(false);
    this.state = STATE.READY;
  }

  resolveActions(rawActs) {
    const rawList = Array.isArray(rawActs) ? rawActs : Array.prototype.slice.call(arguments);
    const P = this.players;
    const n = this.playerCount;
    const keys = [];
    for (let k = 0; k < n; k++) keys.push('p' + (k + 1));

    const startBind = [], startBurn = [], startSeed = [], startWet = [];
    const startScourImm = [], startSeedImm = [], startBindImm = []; // V4.0 免疫期快照
    for (let i = 0; i < n; i++) {
      startBind.push(P[i].status.bindTurns);
      startBurn.push(P[i].status.burnTurns);
      startSeed.push(P[i].status.seedTurns);
      startWet.push(P[i].status.wetTurns);
      startScourImm.push(P[i].status.scourImmuneTurns);
      startSeedImm.push(P[i].status.seedImmuneTurns);
      startBindImm.push(P[i].status.bindImmuneTurns);
    }

    const acts = [];
    for (let i = 0; i < n; i++) acts.push(normalizeAction(rawList[i]));

    const forcedChanges = [];
    const lines = [];

    for (let i = 0; i < n; i++) {
      if (P[i].status.hasVein && P[i].hp > 0 && P[i].status.shellLayers < MAX_SHELL) {
        P[i].status.shellLayers += 1;
        lines.push(P[i].name + ' 的岩脉共鸣涌动，自动凝聚 1 层岩壳（' + P[i].status.shellLayers + '/' + MAX_SHELL + '）！');
      }
    }

    for (let i = 0; i < n; i++) {
      const act = acts[i];
      const boundLocked = startBind[i] > 0 && (act.type === ACTION.GATHER || act.type === ACTION.USE);
      const isEscapeSlash = act.type === ACTION.USE && act.element === ELEMENT.JIN && act.route === 'attack';
      if (boundLocked && !isEscapeSlash && !sameAction(act, P[i].status.lastAction)) {
        const from = { ...act };
        act.type = ACTION.DEFEND;
        act.element = null;
        act.route = null;
        act.amount = 0;
        act.targets = null;
        forcedChanges.push({ player: keys[i], from, to: { ...act }, reason: '被束缚，只能防御、复读上一动作或以金之斩挣脱' });
        lines.push(P[i].name + ' 被藤蔓束缚，只能防御、复读上一动作，或用金之斩斩断藤蔓！');
      } else if ((act.type === ACTION.USE || act.type === ACTION.GATHER) && !this.isActionFeasible(i, act)) {
        const from = { ...act };
        const blocked = act.type === ACTION.USE ? this._blockedUseReason(i, act) : null;
        const reason = blocked ? blocked[0] : '资源不足，被迫防御';
        const line = blocked ? blocked[1] : P[i].name + ' 资源不足，被迫防御！';
        act.type = ACTION.DEFEND;
        act.element = null;
        act.route = null;
        act.amount = 0;
        act.targets = null;
        forcedChanges.push({ player: keys[i], from, to: { ...act }, reason });
        lines.push(line);
      }
    }

    const defended = acts.map(a => a.type === ACTION.DEFEND);

    this._wall = new Array(n).fill(false);
    this._thornRock = new Array(n).fill(false);
    this._noReflect = new Array(n).fill(false);
    const events = [];
    const hpDelta = new Array(n).fill(0);
    const lossTaken = new Array(n).fill(0);

    for (let i = 0; i < n; i++) {
      if (acts[i].type === ACTION.USE) {
        this._resolveUse(i, acts[i], events, lines, hpDelta);
      }
    }

    const attackSources = new Map();
    for (const ev of events) {
      if (ev.src === ev.target) continue;
      if (!attackSources.has(ev.target)) attackSources.set(ev.target, new Set());
      attackSources.get(ev.target).add(ev.src);
    }

    const gatherOk = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (acts[i].type === ACTION.GATHER) {
        gatherOk[i] = true;
        lines.push(P[i].name + ' 成功接取 ' + (ELEMENT_LABEL[acts[i].element] || '?') + ' +1');
      }
    }

    for (let i = 0; i < n; i++) {
      if (gatherOk[i] && acts[i].element) {
        P[i].elements[acts[i].element] = Math.min(MAX_ELEMENT, P[i].elements[acts[i].element] + 1);
      }
    }

    const reflectMap = new Map();
    for (const ev of events) {
      const t = ev.target;
      let amount = ev.amount;
      let apply = true;
      if (ev.ap && this._wall[t]) {
        this._wall[t] = false;
        // V4.1：穿甲基础伤害已为 2，击碎墙体不再额外 +1
        lines.push(P[t].name + ' 的荆棘之墙被穿甲弹击碎，2 点伤害照常生效、无反弹！');
        if (this.multiRules) {
          // V4.0：击碎木墙后压制该目标本回合的荆棘岩/岩脉共鸣反伤
          this._noReflect[t] = true;
          lines.push('穿甲弹的冲击压制了 ' + P[t].name + ' 的反伤能力（本回合失效）！');
        }
      } else if (this._thornRock[t]) {
        if (!ev.ap) {
          amount = 0;
          apply = false;
        } else if (this.multiRules && P[t].status.shellLayers > 0) {
          // V4.0：穿甲弹命中荆棘岩，额外震落 1 层岩壳
          P[t].status.shellLayers -= 1;
          lines.push('穿甲弹贯穿荆棘岩，震落了 ' + P[t].name + ' 的 1 层岩壳（剩余 ' + P[t].status.shellLayers + ' 层）！');
        }
      } else if (!ev.ignore) {
        if (defended[t]) {
          amount = 0;
        } else if (this._wall[t]) {
          amount = 0;
          apply = false;
          if (ev.src !== t && !reflectMap.has(ev.src)) reflectMap.set(ev.src, t);
        } else if (P[t].status.shellLayers > 0 && ev.src !== t) {
          const absorb = Math.min(P[t].status.shellLayers, amount);
          if (absorb > 0) {
            P[t].status.shellLayers -= absorb;
            amount -= absorb;
            lines.push(P[t].name + ' 的岩壳抵消了 ' + absorb + ' 点伤害（剩余 ' + P[t].status.shellLayers + ' 层）！');
          }
        }
      }
      hpDelta[t] -= amount;
      if (apply) {
        if (amount > 0 && ev.src !== t) lossTaken[t] += amount;
        const victim = P[t];
        if (ev.burn) victim.status.burnTurns = ev.burn.turns;
        if (ev.seed) {
          victim.status.seedTurns = ev.seed.turns;
          victim.status.seedOwner = ev.seed.owner;
        }
        if (ev.scour && !defended[t] && !this._wall[t] && !this._thornRock[t]) {
          const candidates = ['Jin', 'Mu', 'Huo', 'Tu'].filter(k => victim.elements[k] > 0);
          if (candidates.length > 0) {
            const k = candidates[Math.floor(Math.random() * candidates.length)];
            victim.elements[k] -= 1;
            lines.push('激流冲刷，毁去了 ' + victim.name + ' 的 1 枚 ' + ELEMENT_LABEL[k] + '！');
            // V4.0：冲刷成功销毁元素后，给予 2 回合冲刷免疫
            if (this.multiRules) {
              victim.status.scourImmuneTurns = 2;
              lines.push(victim.name + ' 对冲刷获得了 2 回合免疫！');
            }
          } else {
            lines.push(victim.name + ' 无金木火土元素可被冲刷。');
          }
        }
      }
    }

    for (const [src, wallOwner] of reflectMap) {
      hpDelta[src] -= 1;
      lines.push(P[wallOwner].name + ' 的荆棘之墙反弹 1 点伤害给 ' + P[src].name + '！');
    }

    for (let r = 0; r < n; r++) {
      if (!this._thornRock[r]) continue;
      if (this._noReflect[r]) continue; // V4.0：反伤被穿甲弹压制
      const srcs = attackSources.get(r);
      if (!srcs) continue;
      for (const src of srcs) {
        let dmg = 2;
        let note = '';
        if (P[r].status.shellLayers > 0) {
          P[r].status.shellLayers -= 1;
          dmg = 3;
          note = '（岩壳加持 +1，消耗 1 层）';
        }
        hpDelta[src] -= dmg;
        lines.push(P[r].name + ' 的荆棘岩反击 ' + P[src].name + '，造成 ' + dmg + ' 点无视防御的伤害！' + note);
      }
    }

    for (let v = 0; v < n; v++) {
      if (!defended[v] || !P[v].status.hasVein) continue;
      if (this._noReflect[v]) continue; // V4.0：反伤被穿甲弹压制
      const srcs = attackSources.get(v);
      if (!srcs) continue;
      for (const src of srcs) {
        hpDelta[src] -= 1;
        lines.push(P[v].name + ' 的岩脉共鸣反震 ' + P[src].name + '，造成 1 点无视防御的伤害！');
      }
    }

    for (let i = 0; i < n; i++) {
      if (defended[i]) {
        const st = P[i].status;
        const wetCleared = startWet[i] > 0 && st.wetTurns > 0;
        if (st.burnTurns > 0 || st.seedTurns > 0 || wetCleared) {
          const cleared = [];
          if (st.burnTurns > 0) cleared.push('灼烧');
          if (st.seedTurns > 0) cleared.push('寄生');
          if (wetCleared) cleared.push('水渍');
          st.burnTurns = 0;
          st.seedTurns = 0;
          if (wetCleared) st.wetTurns = 0;
          lines.push(P[i].name + ' 防御驱散了' + cleared.join('与') + '状态！');
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (!defended[i] && startBurn[i] > 0) {
        hpDelta[i] -= 1;
        lossTaken[i] += 1;
        P[i].status.burnTurns = Math.max(0, P[i].status.burnTurns - 1);
        lines.push(P[i].name + ' 被灼烧侵蚀，受到 1 点伤害！');
      }
    }

    for (let i = 0; i < n; i++) {
      if (!defended[i] && startWet[i] > 0) {
        hpDelta[i] -= 1;
        lossTaken[i] += 1;
        P[i].status.wetTurns = 0;
        lines.push(P[i].name + ' 身上的水渍渗透爆发，受到 1 点无视防御的伤害！');
      }
    }

    for (let i = 0; i < n; i++) {
      if (!defended[i] && startSeed[i] > 0) {
        const victim = P[i];
        const ownerIdx = victim.status.seedOwner >= 0 ? victim.status.seedOwner : (i + 1) % n;
        const owner = P[ownerIdx];
        const candidates = Object.keys(victim.elements).filter(k => victim.elements[k] > 0);
        if (candidates.length > 0) {
          const k = candidates[Math.floor(Math.random() * candidates.length)];
          victim.elements[k] = Math.max(0, victim.elements[k] - 1);
          owner.elements[k] = Math.min(MAX_ELEMENT, owner.elements[k] + 1);
          lines.push(owner.name + ' 的种子窃取了 ' + victim.name + ' 的 ' + ELEMENT_LABEL[k] + '！');
        } else {
          lines.push(victim.name + ' 的种子无元素可偷，逐渐枯萎！');
        }
        victim.status.seedTurns = Math.max(0, victim.status.seedTurns - 1);
        // V4.0：种子存活到结算即视为命中成功，给予 2 回合种子免疫
        if (this.multiRules) {
          victim.status.seedImmuneTurns = 2;
          lines.push(victim.name + ' 对种子寄生获得了 2 回合免疫！');
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (startBind[i] > 0 && lossTaken[i] > 0 && P[i].status.bindTurns > 0) {
        P[i].status.bindTurns = 0;
        lines.push(P[i].name + ' 因受到伤害，藤蔓断裂挣脱了束缚！');
        if (this.multiRules) P[i].status.bindImmuneTurns = 1; // V4.0 挣脱后免疫 1 回合
      }
    }

    // V4.0：标记本回合已通过"金之斩/受击"提前破除束缚的玩家（区别于自然到期）
    const bindBrokenEarly = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (startBind[i] > 0 && P[i].status.bindTurns === 0) bindBrokenEarly[i] = true;
    }

    for (let i = 0; i < n; i++) {
      if (startBind[i] > 0) {
        P[i].status.bindTurns = Math.max(0, P[i].status.bindTurns - 1);
        // V4.0：束缚解除后获得 1 回合束缚免疫（含自然到期与提前挣脱）
        if (P[i].status.bindTurns === 0 && this.multiRules && !bindBrokenEarly[i]) {
          P[i].status.bindImmuneTurns = 1;
          lines.push(P[i].name + ' 的藤蔓彻底枯萎，获得了 1 回合束缚免疫！');
        }
      }
    }

    // V4.0：三种招式免疫期按各自快照递减（本回合新获得的免疫不受当回合递减影响）
    for (let i = 0; i < n; i++) {
      if (startScourImm[i] > 0) P[i].status.scourImmuneTurns = Math.max(0, P[i].status.scourImmuneTurns - 1);
      if (startSeedImm[i] > 0) P[i].status.seedImmuneTurns = Math.max(0, P[i].status.seedImmuneTurns - 1);
      if (startBindImm[i] > 0) P[i].status.bindImmuneTurns = Math.max(0, P[i].status.bindImmuneTurns - 1);
    }

    for (let i = 0; i < n; i++) {
      P[i].status.lastAction = { type: acts[i].type, element: acts[i].element, route: acts[i].route, amount: acts[i].amount, targets: acts[i].targets };
    }

    for (let i = 0; i < n; i++) {
      P[i].hp = clamp(P[i].hp + hpDelta[i], 0, P[i].maxHp);
    }

    const actionsObj = {};
    for (let k = 0; k < n; k++) actionsObj[keys[k]] = { ...acts[k] };

    const report = {
      p1_hp_change: hpDelta[0],
      p2_hp_change: hpDelta[1],
      hpChanges: hpDelta.slice(),
      actions: actionsObj,
      forcedChanges,
      log_message: lines.join('\n'),
      winner: this.getWinner(),
      state: STATE.RESULT,
      players: JSON.parse(JSON.stringify(P))
    };
    return report;
  }

  _resolveUse(i, act, events, lines, hpDelta) {
    const P = this.players;
    const p = P[i];
    const name = p.name;
    const key = act.element + '.' + act.route;

    switch (key) {
      case 'Jin.attack': {
        p.elements.Jin -= 1;
        const ts = this._resolveTargets(i, act) || this._defaultTarget(i);
        events.push({ target: ts[0], amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 金→金之斩 → ' + P[ts[0]].name + '！');
        if (p.status.bindTurns > 0) {
          p.status.bindTurns = 0;
          lines.push(name + ' 以金之斩斩断藤蔓，挣脱了束缚！');
          if (this.multiRules) p.status.bindImmuneTurns = 1; // V4.0 挣脱后免疫 1 回合
        }
        break;
      }
      case 'Jin.craftGatling':
        p.elements.Jin -= 1;
        p.weapons.hasGatling = true;
        lines.push(name + ' 铸造加特林成功！');
        break;
      case 'Jin.gatlingFire': {
        const nn = act.amount;
        const tg = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        p.elements.Jin -= nn;
        for (let k = 0; k < 2 * nn; k++) {
          events.push({ target: tg, amount: 1, ignore: false, src: i });
        }
        lines.push(name + ' 使用 金→加特林射击（' + (2 * nn) + ' 发子弹）→ ' + P[tg].name + '！');
        break;
      }
      case 'Jin.craftDual':
        p.elements.Jin -= 1;
        p.weapons.hasDualPistols = true;
        lines.push(name + ' 铸造双枪成功！');
        break;
      case 'Jin.dualFire': {
        p.elements.Jin -= 1;
        const pair = this._resolveTargets(i, act) || [this._defaultTarget(i)[0], this._defaultTarget(i)[0]];
        events.push({ target: pair[0], amount: 1, ignore: false, src: i });
        events.push({ target: pair[1], amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 金→双枪射击 → ' + P[pair[0]].name + '、' + P[pair[1]].name + '！');
        break;
      }
      case 'Jin.craftAP':
        p.elements.Jin -= 1;
        p.weapons.armorPiercing += 1;
        lines.push(name + ' 铸造穿甲弹 +1！');
        break;
      case 'Jin.apFire': {
        p.weapons.armorPiercing -= 1;
        const ta = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        // V4.1：穿甲射击基础伤害提升为 2（全局生效）
        events.push({ target: ta, amount: 2, ignore: true, ap: true, src: i });
        lines.push(name + ' 使用 金→穿甲射击 → ' + P[ta].name + '！');
        break;
      }
      case 'Mu.attack': {
        p.elements.Mu -= 1;
        const tm = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tm, amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 木→木之刺 → ' + P[tm].name + '！');
        break;
      }
      case 'Mu.bind': {
        p.elements.Mu -= 1;
        const tb = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        P[tb].status.bindTurns = 2;
        lines.push(name + ' 使用 木→藤蔓束缚 → ' + P[tb].name + '！');
        break;
      }
      case 'Mu.seed': {
        p.elements.Mu -= 2;
        const tsd = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tsd, amount: 1, ignore: false, seed: { turns: 1, owner: i }, src: i });
        lines.push(name + ' 使用 木→种子寄生 → ' + P[tsd].name + '！');
        break;
      }
      case 'Mu.thorn':
        p.elements.Mu -= 2;
        this._wall[i] = true;
        lines.push(name + ' 使用 木→荆棘之墙！');
        break;
      case 'Huo.fireball': {
        p.elements.Huo -= 1;
        const tf = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tf, amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 火→火球术 → ' + P[tf].name + '！');
        break;
      }
      case 'Huo.fireRain': {
        const huo = p.elements.Huo;
        const trs = this._resolveTargets(i, act) || this._defaultTarget(i);
        p.elements.Huo = 0;
        for (const t of trs) {
          events.push({ target: t, amount: 1, ignore: false, src: i });
        }
        lines.push(name + ' 使用 火→火球雨（倾泻 ' + huo + ' 点火，命中 ' + trs.length + ' 个目标）！');
        break;
      }
      case 'Huo.blaze': {
        p.elements.Huo -= 2;
        const tbl = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tbl, amount: 3, ignore: false, src: i });
        events.push({ target: i, amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 火→烈焰爆发 → ' + P[tbl].name + '！');
        break;
      }
      case 'Huo.burn': {
        p.elements.Huo -= 2;
        const tbr = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tbr, amount: 1, ignore: false, burn: { turns: 2 }, src: i });
        lines.push(name + ' 使用 火→灼烧烙印 → ' + P[tbr].name + '！');
        break;
      }
      case 'Shui.attack': {
        p.elements.Shui -= 1;
        const ts = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: ts, amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 水→水弹 → ' + P[ts].name + '！');
        break;
      }
      case 'Shui.seep': {
        p.elements.Shui -= 1;
        const tp = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        P[tp].status.wetTurns = 1;
        lines.push(name + ' 使用 水→渗透，' + P[tp].name + ' 身上留下水渍（下回合末未防御则受 1 点穿透伤害）！');
        break;
      }
      case 'Shui.scour': {
        p.elements.Shui -= 2;
        const tc = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tc, amount: 1, ignore: false, scour: true, src: i });
        lines.push(name + ' 使用 水→冲刷 → ' + P[tc].name + '（命中则毁去其 1 枚金/木/火/土）！');
        break;
      }
      case 'Shui.spring': {
        p.elements.Shui -= 2;
        if (p.hp < p.maxHp) {
          hpDelta[i] += 1;
          lines.push(name + ' 使用 水→生命之泉，回复 1 点生命！');
        } else if (p.maxHp < MAX_HP) {
          p.maxHp = Math.min(MAX_HP, p.maxHp + 1);
          hpDelta[i] += 0.5;
          lines.push(name + ' 使用 水→生命之泉，生命上限提升至 ' + p.maxHp + '，并回复 0.5 点生命！');
        } else {
          hpDelta[i] += 0.5;
          lines.push(name + ' 使用 水→生命之泉，泉水满溢（上限已至 ' + MAX_HP + '），无法回复更多。');
        }
        break;
      }
      case 'Tu.attack': {
        p.elements.Tu -= 1;
        const tt = (this._resolveTargets(i, act) || this._defaultTarget(i))[0];
        events.push({ target: tt, amount: 1, ignore: false, src: i });
        lines.push(name + ' 使用 土→土弹 → ' + P[tt].name + '！');
        break;
      }
      case 'Tu.shell': {
        p.elements.Tu -= 1;
        if (p.status.shellLayers < MAX_SHELL) {
          p.status.shellLayers += 1;
          lines.push(name + ' 使用 土→岩壳，凝聚岩壳 ' + p.status.shellLayers + '/' + MAX_SHELL + ' 层！');
        } else {
          lines.push(name + ' 使用 土→岩壳，岩壳已达 ' + MAX_SHELL + ' 层上限，白白消耗。');
        }
        break;
      }
      case 'Tu.thornRock':
        p.elements.Tu -= 2;
        this._thornRock[i] = true;
        lines.push(name + ' 使用 土→荆棘岩，固守待机、以岩刺反击来犯者！');
        break;
      case 'Tu.vein':
        p.elements.Tu -= 3;
        p.status.hasVein = true;
        lines.push(name + ' 使用 土→岩脉共鸣，大地脉动永久觉醒：每回合自动凝聚岩壳，防御时反震来袭者！');
        break;
    }
  }
}

// ---- UMD ������Node.js ��������Ϊģ�鵼�������������ȫ�ֱ����÷� ----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ACTION, STATE, ELEMENT, ELEMENT_LABEL, GATHERABLE_ELEMENTS,
    MAX_ELEMENT, MAX_HP, MAX_SHELL, SELF_ROUTES, ROUTES,
    clamp, makePlayer, normalizeAction, sameAction, formatAction,
    GameEngine
  };
}
