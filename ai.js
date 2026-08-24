'use strict';

// Node 环境下自动引入引擎常量（浏览器中由 index.html 先加载 engine.js 提供同名全局）
if (typeof module !== 'undefined' && module.exports) {
  const _engine = require('./engine');
  for (const _k of ['ACTION', 'ROUTES', 'GATHERABLE_ELEMENTS', 'ELEMENT']) {
    if (typeof globalThis[_k] === 'undefined') globalThis[_k] = _engine[_k];
  }
}

const BEHAVIORS = Object.freeze(['jinsmith', 'woodkeeper', 'firenova', 'watersage', 'stoneward', 'balanced', 'guardian']);

const BEHAVIOR_LABEL = Object.freeze({
  jinsmith: '金匠',
  woodkeeper: '木控',
  firenova: '火爆',
  watersage: '水谋',
  stoneward: '磐石',
  balanced: '均衡',
  guardian: '防守'
});

function randomBehavior() {
  return BEHAVIORS[Math.floor(Math.random() * BEHAVIORS.length)];
}

function canUse(player, action, allPlayers) {
  const routes = ROUTES[action.element];
  if (!routes || !routes[action.route]) return false;
  if (action.element === 'Mu' && action.route === 'bind') {
    if (!Array.isArray(allPlayers)) return false;
    let def = -1;
    for (let k = 0; k < allPlayers.length; k++) {
      if (k !== player.id && allPlayers[k].hp > 0) { def = k; break; }
    }
    if (def < 0 || allPlayers[def].status.bindTurns > 0) return false; // 束缚不可叠加
    if (allPlayers[def].status.bindImmuneTurns > 0) return false;      // V4.0 束缚免疫期（多人局）
  }
  const r = routes[action.route];
  if (r.cost === 'amount') {
    return player.weapons.hasGatling && action.amount >= 1 && player.elements.Jin >= action.amount;
  }
  if (r.cost === 'all') return player.elements[action.element] >= 1;
  if (r.cost === 'ap') return player.weapons.armorPiercing >= 1;
  if (typeof r.cost === 'number') {
    if (player.elements[action.element] < r.cost) return false;
    if (action.route === 'craftGatling' && player.weapons.hasGatling) return false;
    if (action.route === 'craftDual' && player.weapons.hasDualPistols) return false;
    if (action.route === 'gatlingFire' && !player.weapons.hasGatling) return false;
    if (action.route === 'dualFire' && !player.weapons.hasDualPistols) return false;
    return true;
  }
  return false;
}

function isFeasible(player, action, allPlayers) {
  if (action.type === ACTION.DEFEND) return true;
  if (action.type === ACTION.GATHER) return GATHERABLE_ELEMENTS.indexOf(action.element) !== -1;
  if (action.type === ACTION.USE) return canUse(player, action, allPlayers);
  return false;
}

function pickWeighted(entries) {
  let total = 0;
  for (const e of entries) total += e.w;
  if (total <= 0) return null;
  let roll = Math.random() * total;
  for (const e of entries) {
    roll -= e.w;
    if (roll < 0) return e.act;
  }
  return entries[entries.length - 1].act;
}

function boundAction(ai, allPlayers) {
  if (ai.elements.Jin >= 1 && Math.random() < 0.4) {
    const escape = { type: ACTION.USE, element: 'Jin', route: 'attack', amount: 0, targets: null };
    if (isFeasible(ai, escape, allPlayers)) return escape;
  }
  const last = ai.status.lastAction;
  if (last && Math.random() < 0.5) {
    const repeat = { type: last.type, element: last.element, route: last.route, amount: last.amount, targets: last.targets || null };
    if (isFeasible(ai, repeat, allPlayers)) return repeat;
  }
  return { type: ACTION.DEFEND };
}

function gatlingAmount(ai) {
  return Math.max(1, Math.min(ai.elements.Jin, 3));
}

function behaviorConfig(behavior) {
  switch (behavior) {
    case 'jinsmith':
      return {
        g: { Jin: 4, Mu: 1, Shui: 1, Huo: 1, Tu: 1 },
        d: 1,
        craft: { gatling: 3, dual: 2, ap: 2 },
        metal: { attack: 1, gatling: 3, dual: 2, ap: 2 },
        wood: {},
        water: {},
        fire: { fireball: 1 },
        earth: {}
      };
    case 'woodkeeper':
      return {
        g: { Jin: 1, Mu: 4, Shui: 1, Huo: 1, Tu: 1 },
        d: 1,
        craft: {},
        metal: { attack: 1 },
        wood: { bind: 3, seed: 2, thorn: 2 },
        water: {},
        fire: { fireball: 1 },
        earth: {}
      };
    case 'firenova':
      return {
        g: { Jin: 1, Mu: 1, Shui: 1, Huo: 4, Tu: 1 },
        d: 1,
        craft: {},
        metal: { attack: 1 },
        wood: {},
        water: {},
        fire: { fireball: 3, blaze: 3, burn: 3, rain: 2 },
        earth: {}
      };
    case 'watersage':
      return {
        g: { Jin: 1, Mu: 1, Shui: 5, Huo: 1, Tu: 1 },
        d: 1,
        craft: {},
        metal: { attack: 1 },
        wood: {},
        water: { attack: 1, seep: 3, scour: 3, spring: 2 },
        fire: {},
        earth: {}
      };
    case 'stoneward':
      return {
        g: { Jin: 1, Mu: 1, Shui: 1, Huo: 1, Tu: 5 },
        d: 3,
        craft: {},
        metal: { attack: 1 },
        wood: {},
        water: {},
        fire: {},
        earth: { attack: 1, shell: 3, thornRock: 3, vein: 3 }
      };
    case 'guardian':
      return {
        g: { Jin: 2, Mu: 2, Shui: 1, Huo: 1, Tu: 2 },
        d: 5,
        craft: {},
        metal: { attack: 1 },
        wood: { bind: 1, thorn: 2 },
        water: { seep: 1, spring: 1 },
        fire: { fireball: 1 },
        earth: { shell: 2, thornRock: 2 }
      };
    default:
      return {
        g: { Jin: 2, Mu: 2, Shui: 2, Huo: 2, Tu: 2 },
        d: 1,
        craft: { gatling: 1, dual: 1, ap: 1 },
        metal: { attack: 1, gatling: 1, dual: 1, ap: 1 },
        wood: { bind: 1, seed: 1, thorn: 1 },
        water: { attack: 1, seep: 1, scour: 1, spring: 1 },
        fire: { fireball: 1, blaze: 1, burn: 1, rain: 1 },
        earth: { attack: 1, shell: 1, thornRock: 1, vein: 1 }
      };
  }
}

function chooseAIAction(ai, opponent, allPlayers, behavior) {
  behavior = behavior || 'balanced';

  if (ai.status.bindTurns > 0) return boundAction(ai, allPlayers);

  const cfg = behaviorConfig(behavior);
  const pool = [];
  const add = (act, w) => {
    if (w > 0 && isFeasible(ai, act, allPlayers)) pool.push({ act, w });
  };

  if (opponent.hp <= 1) {
    add({ type: ACTION.USE, element: 'Huo', route: 'fireball' }, (cfg.fire.fireball || 0) + 3);
    add({ type: ACTION.USE, element: 'Huo', route: 'blaze' }, (cfg.fire.blaze || 0) + 2);
    add({ type: ACTION.USE, element: 'Huo', route: 'burn' }, (cfg.fire.burn || 0) + 2);
    add({ type: ACTION.USE, element: 'Jin', route: 'attack' }, (cfg.metal.attack || 0) + 3);
    add({ type: ACTION.USE, element: 'Jin', route: 'apFire' }, (cfg.metal.ap || 0) + 2);
    add({ type: ACTION.USE, element: 'Jin', route: 'dualFire' }, (cfg.metal.dual || 0) + 2);
    add({ type: ACTION.USE, element: 'Jin', route: 'gatlingFire', amount: gatlingAmount(ai) }, (cfg.metal.gatling || 0) + 2);
    add({ type: ACTION.USE, element: 'Shui', route: 'attack' }, (cfg.water.attack || 0) + 2);
    add({ type: ACTION.USE, element: 'Tu', route: 'attack' }, (cfg.earth.attack || 0) + 2);
  }

  for (const el of GATHERABLE_ELEMENTS) {
    add({ type: ACTION.GATHER, element: el }, cfg.g[el] || 1);
  }
  add({ type: ACTION.DEFEND }, cfg.d || 1);

  if (ai.elements.Jin >= 1) {
    add({ type: ACTION.USE, element: 'Jin', route: 'attack' }, cfg.metal.attack || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'craftGatling' }, cfg.craft.gatling || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'craftDual' }, cfg.craft.dual || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'craftAP' }, cfg.craft.ap || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'dualFire' }, cfg.metal.dual || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'gatlingFire', amount: gatlingAmount(ai) }, cfg.metal.gatling || 1);
    add({ type: ACTION.USE, element: 'Jin', route: 'apFire' }, cfg.metal.ap || 1);
  }
  if (ai.elements.Mu >= 1) {
    add({ type: ACTION.USE, element: 'Mu', route: 'attack' }, cfg.wood.attack || 1);
    add({ type: ACTION.USE, element: 'Mu', route: 'bind' }, cfg.wood.bind || 1);
    add({ type: ACTION.USE, element: 'Mu', route: 'seed' }, cfg.wood.seed || 1);
    add({ type: ACTION.USE, element: 'Mu', route: 'thorn' }, cfg.wood.thorn || 1);
  }
  if (ai.elements.Huo >= 1) {
    add({ type: ACTION.USE, element: 'Huo', route: 'fireball' }, cfg.fire.fireball || 1);
    add({ type: ACTION.USE, element: 'Huo', route: 'blaze' }, cfg.fire.blaze || 1);
    add({ type: ACTION.USE, element: 'Huo', route: 'burn' }, cfg.fire.burn || 1);
    if (ai.elements.Huo >= 3) {
      add({ type: ACTION.USE, element: 'Huo', route: 'fireRain' }, cfg.fire.rain || 1);
    }
  }
  if (ai.elements.Shui >= 1) {
    add({ type: ACTION.USE, element: 'Shui', route: 'attack' }, cfg.water.attack || 1);
    add({ type: ACTION.USE, element: 'Shui', route: 'seep' }, cfg.water.seep || 1);
    if (ai.elements.Shui >= 2) {
      add({ type: ACTION.USE, element: 'Shui', route: 'scour' }, cfg.water.scour || 1);
      const hurt = ai.hp < ai.maxHp;
      const full = ai.hp === ai.maxHp && ai.maxHp < 5;
      if (hurt || full) {
        add({ type: ACTION.USE, element: 'Shui', route: 'spring' }, (cfg.water.spring || 1) + (hurt ? 2 : 0));
      }
    }
  }
  if (ai.elements.Tu >= 1) {
    add({ type: ACTION.USE, element: 'Tu', route: 'attack' }, cfg.earth.attack || 1);
    add({ type: ACTION.USE, element: 'Tu', route: 'shell' }, cfg.earth.shell || 1);
    if (ai.elements.Tu >= 2) {
      add({ type: ACTION.USE, element: 'Tu', route: 'thornRock' }, cfg.earth.thornRock || 1);
    }
    if (ai.elements.Tu >= 3 && !ai.status.hasVein) {
      add({ type: ACTION.USE, element: 'Tu', route: 'vein' }, (cfg.earth.vein || 1) + 1);
    }
  }

  return pickWeighted(pool) || { type: ACTION.DEFEND };
}

// ---- UMD ������Node.js ��������Ϊģ�鵼�������������ȫ�ֱ����÷� ----
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    BEHAVIORS, BEHAVIOR_LABEL, randomBehavior,
    canUse, isFeasible, chooseAIAction
  };
}
