'use strict';

// 引擎与 AI 已模块化（UMD 导出），测试直接 require
const { GameEngine, ACTION, STATE, ELEMENT, ELEMENT_LABEL, ROUTES, MAX_ELEMENT, GATHERABLE_ELEMENTS, formatAction } = require('./engine');
const { BEHAVIORS, BEHAVIOR_LABEL, randomBehavior, chooseAIAction } = require('./ai');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const groups = [];
let current = null;

function describe(title, fn) {
  groups.push({ title, tests: [] });
  current = groups[groups.length - 1];
  fn();
  current = null;
}

function it(name, fn) {
  current.tests.push({ name, fn, skip: false });
}

function itSkip(name, fn) {
  current.tests.push({ name, fn, skip: true });
}

function fresh() {
  return new GameEngine();
}

function gather(el) {
  return { type: ACTION.GATHER, element: el };
}

function use(el, route, amount) {
  return { type: ACTION.USE, element: el, route, amount: amount || 0 };
}

const DEF = { type: ACTION.DEFEND };

describe('旧气系统（已废弃，全部跳过）', () => {
  itSkip('攻 vs 防', () => {});
  itSkip('攻 vs 蓄', () => {});
  itSkip('攻 vs 攻', () => {});
  itSkip('蓄 vs 蓄 / 蓄 vs 防 / 防 vs 防', () => {});
  itSkip('攻击但气为 0 -> 强制改蓄力', () => {});
  itSkip('游戏结束与胜负', () => {});
  itSkip('上限/下限保护', () => {});
  itSkip('攻击威力与防御减伤', () => {});
  itSkip('攻击威力对拼', () => {});
  itSkip('威力随气量解锁', () => {});
  itSkip('威力超过气量自动钳制', () => {});
});

describe('资源与接取', () => {
  it('接取 vs 接取：双方各 +1', () => {
    const e = fresh();
    const r = e.executeRound(gather('Jin'), gather('Huo'));
    assert(e.players[0].elements.Jin === 1 && e.players[1].elements.Huo === 1,
      'got ' + JSON.stringify([e.players[0].elements.Jin, e.players[1].elements.Huo]));
    assert(r.log_message.indexOf('成功接取') !== -1, r.log_message);
  });

  it('接取 vs 防御：接取成功且无伤害', () => {
    const e = fresh();
    const r = e.executeRound(gather('Jin'), DEF);
    assert(e.players[0].elements.Jin === 1, 'got ' + e.players[0].elements.Jin);
    assert(r.p2_hp_change === 0 && r.p1_hp_change === 0, 'hp changed');
  });

  it('使用 vs 接取：接取照常成功，正常吃伤害', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), gather('Jin'));
    assert(e.players[1].elements.Jin === 1, 'gather failed, got ' + e.players[1].elements.Jin);
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(r.log_message.indexOf('成功接取') !== -1, r.log_message);
  });

  it('接取上限 9：不溢出', () => {
    const e = fresh();
    e.players[0].elements.Jin = 9;
    e.executeRound(gather('Jin'), DEF);
    assert(e.players[0].elements.Jin === 9, 'got ' + e.players[0].elements.Jin);
  });

  it('水/土 已开放：接取正常获得元素', () => {
    const e = fresh();
    const r = e.executeRound(gather('Shui'), gather('Tu'));
    assert(r.forcedChanges.length === 0, JSON.stringify(r.forcedChanges));
    assert(e.players[0].elements.Shui === 1, 'got ' + e.players[0].elements.Shui);
    assert(e.players[1].elements.Tu === 1, 'got ' + e.players[1].elements.Tu);
    assert(GATHERABLE_ELEMENTS.indexOf('Shui') !== -1 && GATHERABLE_ELEMENTS.indexOf('Tu') !== -1, 'not gatherable');
  });
});

describe('金系', () => {
  it('金之斩：1 金造成 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    const r = e.executeRound(use('Jin', 'attack'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[0].elements.Jin === 0, 'got ' + e.players[0].elements.Jin);
    assert(r.log_message.indexOf('金之斩') !== -1, r.log_message);
  });

  it('铸造加特林：获得武器', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    const r = e.executeRound(use('Jin', 'craftGatling'), DEF);
    assert(e.players[0].weapons.hasGatling === true, 'no gatling');
    assert(e.players[0].elements.Jin === 0, 'got ' + e.players[0].elements.Jin);
    assert(r.forcedChanges.length === 0, JSON.stringify(r.forcedChanges));
  });

  it('加特林射击：N 金射出 2N 发子弹', () => {
    const e = fresh();
    e.players[0].elements.Jin = 2;
    e.players[0].weapons.hasGatling = true;
    const r = e.executeRound(use('Jin', 'gatlingFire', 2), gather('Jin'));
    assert(r.p2_hp_change === -4, 'got ' + r.p2_hp_change);
    assert(e.players[0].elements.Jin === 0, 'got ' + e.players[0].elements.Jin);
  });

  it('加特林射击 vs 防御：每发子弹独立减伤为 0', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    e.players[0].weapons.hasGatling = true;
    const r = e.executeRound(use('Jin', 'gatlingFire', 1), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
  });

  it('铸造双枪 + 双枪射击：2 伤害', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    e.executeRound(use('Jin', 'craftDual'), DEF);
    assert(e.players[0].weapons.hasDualPistols === true, 'no dual');
    e.players[0].elements.Jin = 1;
    const r = e.executeRound(use('Jin', 'dualFire'), gather('Jin'));
    assert(r.p2_hp_change === -2, 'got ' + r.p2_hp_change);
  });

  it('穿甲射击 vs 防御：1 伤穿透', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    e.executeRound(use('Jin', 'craftAP'), DEF);
    assert(e.players[0].weapons.armorPiercing === 1, 'no AP');
    const r = e.executeRound(use('Jin', 'apFire'), DEF);
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[0].weapons.armorPiercing === 0, 'AP not consumed');
  });

  it('穿甲弹击碎荆棘之墙：伤害提升为 2 且不反弹', () => {
    const e = fresh();
    e.players[0].weapons.armorPiercing = 1;
    e.players[1].elements.Mu = 2;
    const r = e.executeRound(use('Jin', 'apFire'), use('Mu', 'thorn'));
    assert(r.p2_hp_change === -2, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === 0, 'got ' + r.p1_hp_change);
    assert(r.log_message.indexOf('击碎') !== -1, r.log_message);
  });
});

describe('木系', () => {
  it('藤蔓束缚：穿透防御，设置 2 回合束缚', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    const r = e.executeRound(use('Mu', 'bind'), DEF);
    assert(e.players[1].status.bindTurns === 2, 'got ' + e.players[1].status.bindTurns);
    assert(r.p1_hp_change === 0 && r.p2_hp_change === 0, 'hp changed');
    assert(r.log_message.indexOf('藤蔓束缚') !== -1, r.log_message);
  });

  it('束缚期间：接取被强制为防御', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), DEF);
    e.players[1].elements.Jin = 1;
    const r = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r.forcedChanges.length === 1 && r.forcedChanges[0].player === 'p2', JSON.stringify(r.forcedChanges));
    assert(r.actions.p2.type === ACTION.DEFEND, JSON.stringify(r.actions.p2));
    assert(e.players[1].elements.Jin === 1, 'bound player should not gain elements');
  });

  it('束缚持续 2 回合后解除', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), DEF);
    assert(e.players[1].status.bindTurns === 2, 'got ' + e.players[1].status.bindTurns);
    e.executeRound(gather('Huo'), gather('Jin'));
    assert(e.players[1].status.bindTurns === 1, 'got ' + e.players[1].status.bindTurns);
    e.executeRound(gather('Huo'), gather('Jin'));
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    const r = e.executeRound(gather('Huo'), gather('Jin'));
    assert(r.forcedChanges.length === 0, 'should be free');
    assert(e.players[1].elements.Jin === 1, 'free player should gather');
  });

  it('种子寄生：1 伤害 + 回合末偷取元素', () => {
    const e = fresh();
    e.players[0].elements.Mu = 2;
    const r1 = e.executeRound(use('Mu', 'seed'), gather('Jin'));
    assert(r1.p2_hp_change === -1, 'got ' + r1.p2_hp_change);
    assert(e.players[1].status.seedTurns === 1, 'got ' + e.players[1].status.seedTurns);

    e.players[1].elements.Jin = 2;
    const r2 = e.executeRound(gather('Huo'), gather('Jin'));
    assert(r2.p2_hp_change === 0, 'seed tick should deal no damage');
    assert(e.players[1].status.seedTurns === 0, 'got ' + e.players[1].status.seedTurns);
    assert(e.players[1].elements.Jin === 2, 'got ' + e.players[1].elements.Jin);
    assert(e.players[0].elements.Jin === 1, 'got ' + e.players[0].elements.Jin);
    assert(r2.log_message.indexOf('窃取') !== -1, r2.log_message);
  });

  it('种子寄生 vs 防御：被驱散不偷取', () => {
    const e = fresh();
    e.players[0].elements.Mu = 2;
    e.executeRound(use('Mu', 'seed'), gather('Jin'));
    e.players[1].elements.Jin = 2;
    const r = e.executeRound(gather('Huo'), DEF);
    assert(e.players[1].status.seedTurns === 0, 'got ' + e.players[1].status.seedTurns);
    assert(e.players[1].elements.Jin === 2, 'should not steal');
    assert(e.players[0].elements.Jin === 0, 'got ' + e.players[0].elements.Jin);
    assert(r.log_message.indexOf('驱散') !== -1, r.log_message);
  });

  it('荆棘之墙：免疫伤害并反弹 1', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    e.players[1].elements.Mu = 2;
    const r = e.executeRound(use('Huo', 'blaze'), use('Mu', 'thorn'));
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -2, 'recoil+reflect got ' + r.p1_hp_change);
    assert(r.log_message.indexOf('反弹') !== -1, r.log_message);
  });
});

describe('火系', () => {
  it('火球术：1 火 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[0].elements.Huo === 0, 'got ' + e.players[0].elements.Huo);
  });

  it('火球雨：消耗全部火，1v1 只打 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Huo = 3;
    const r = e.executeRound(use('Huo', 'fireRain'), gather('Jin'));
    assert(e.players[0].elements.Huo === 0, 'got ' + e.players[0].elements.Huo);
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
  });

  it('烈焰爆发：3 伤害 + 自身反噬 1', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    const r = e.executeRound(use('Huo', 'blaze'), gather('Jin'));
    assert(r.p2_hp_change === -3, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -1, 'got ' + r.p1_hp_change);
  });

  it('烈焰爆发 vs 防御（新规）：完全免疫为 0 伤', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    const r = e.executeRound(use('Huo', 'blaze'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -1, 'recoil got ' + r.p1_hp_change);
  });

  it('灼烧烙印：1 伤害 + 每回合末灼烧 1（无视防御）', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    const r1 = e.executeRound(use('Huo', 'burn'), gather('Jin'));
    assert(r1.p2_hp_change === -1, 'got ' + r1.p2_hp_change);
    assert(e.players[1].status.burnTurns === 2, 'got ' + e.players[1].status.burnTurns);

    const r2 = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r2.p2_hp_change === -1, 'burn tick got ' + r2.p2_hp_change);
    assert(e.players[1].status.burnTurns === 1, 'got ' + e.players[1].status.burnTurns);

    const r3 = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r3.p2_hp_change === -1, 'burn tick got ' + r3.p2_hp_change);
    assert(e.players[1].status.burnTurns === 0, 'got ' + e.players[1].status.burnTurns);
  });

  it('灼烧烙印 vs 防御：伤害挡下，但灼烧状态先附加再被防御驱散', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    const r = e.executeRound(use('Huo', 'burn'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.burnTurns === 0, 'got ' + e.players[1].status.burnTurns);
    assert(r.log_message.indexOf('驱散') !== -1, r.log_message);
  });

  it('灼烧被防御驱散', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    e.executeRound(use('Huo', 'burn'), gather('Jin'));
    assert(e.players[1].status.burnTurns === 2, 'got ' + e.players[1].status.burnTurns);
    const r = e.executeRound(gather('Jin'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.burnTurns === 0, 'got ' + e.players[1].status.burnTurns);
  });
});

describe('判定与胜负', () => {
  it('使用 vs 使用：同时结算', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    e.players[1].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), use('Huo', 'fireball'));
    assert(r.p1_hp_change === -1 && r.p2_hp_change === -1, 'got ' + r.p1_hp_change + ',' + r.p2_hp_change);
  });

  it('资源不足：被迫防御', () => {
    const e = fresh();
    const r = e.executeRound(use('Huo', 'fireball'), DEF);
    assert(r.forcedChanges.length === 1, JSON.stringify(r.forcedChanges));
    assert(r.actions.p1.type === ACTION.DEFEND, JSON.stringify(r.actions.p1));
    assert(r.p2_hp_change === 0 && r.p1_hp_change === 0, 'hp changed');
  });

  it('重复铸造武器：资源不足被迫防御', () => {
    const e = fresh();
    e.players[0].elements.Jin = 1;
    e.players[0].weapons.hasGatling = true;
    const r = e.executeRound(use('Jin', 'craftGatling'), DEF);
    assert(r.forcedChanges.length === 1, JSON.stringify(r.forcedChanges));
    assert(e.players[0].weapons.hasGatling === true, 'should not double craft');
  });

  it('胜负判定：HP 归零对方获胜', () => {
    const e = fresh();
    e.players[0].hp = 1;
    e.players[1].elements.Huo = 1;
    const r = e.executeRound(gather('Jin'), use('Huo', 'fireball'));
    assert(e.players[0].hp === 0, 'got ' + e.players[0].hp);
    assert(r.winner === 'P2', 'got ' + r.winner);
  });

  it('平局判定：双方同时归零', () => {
    const e = fresh();
    e.players[0].hp = 1;
    e.players[1].hp = 1;
    e.players[0].elements.Huo = 1;
    e.players[1].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), use('Huo', 'fireball'));
    assert(e.players[0].hp === 0 && e.players[1].hp === 0, 'hp not zero');
    assert(r.winner === '平局', 'got ' + r.winner);
  });

  it('formatAction 输出', () => {
    assert(formatAction(gather('Jin')) === '接取 金', formatAction(gather('Jin')));
    assert(formatAction(use('Jin', 'attack')) === '使用 金→金之斩', formatAction(use('Jin', 'attack')));
    assert(formatAction(use('Jin', 'gatlingFire', 2)) === '使用 金→加特林射击 ×2', formatAction(use('Jin', 'gatlingFire', 2)));
    assert(formatAction(DEF) === '防御', formatAction(DEF));
  });
});

describe('AI', () => {
  it('randomBehavior 返回合法行为模式', () => {
    for (let i = 0; i < 100; i++) {
      assert(BEHAVIORS.indexOf(randomBehavior()) !== -1, 'invalid behavior');
    }
  });

  it('BEHAVIOR_LABEL 覆盖全部模式', () => {
    for (const b of BEHAVIORS) {
      assert(typeof BEHAVIOR_LABEL[b] === 'string' && BEHAVIOR_LABEL[b].length > 0, 'missing label for ' + b);
    }
  });

  it('chooseAIAction 返回合法动作', () => {
    const e = fresh();
    for (let i = 0; i < 200; i++) {
      const act = chooseAIAction(e.players[0], e.players[1], e.players, randomBehavior());
      assert(act && typeof act.type === 'string', 'no action');
      assert(act.type === ACTION.GATHER || act.type === ACTION.USE || act.type === ACTION.DEFEND, 'bad type ' + act.type);
      assert(e.isActionFeasible(0, act), 'AI proposed infeasible action ' + JSON.stringify(act));
    }
  });

  it('chooseAIAction 在束缚中只能防御或复读', () => {
    const e = fresh();
    e.players[0].status.bindTurns = 2;
    e.players[0].status.lastAction = { type: ACTION.GATHER, element: 'Jin' };
    for (let i = 0; i < 100; i++) {
      const act = chooseAIAction(e.players[0], e.players[1], e.players, 'balanced');
      if (act.type === ACTION.DEFEND) continue;
      assert(act.type === ACTION.GATHER && act.element === 'Jin', 'not defend or repeat: ' + JSON.stringify(act));
    }
  });

  it('chooseAIAction 接取均在可接取元素内', () => {
    const e = fresh();
    for (let i = 0; i < 200; i++) {
      const act = chooseAIAction(e.players[0], e.players[1], e.players, randomBehavior());
      if (act.type === ACTION.GATHER) {
        assert(GATHERABLE_ELEMENTS.indexOf(act.element) !== -1, 'gathered non-gatherable ' + act.element);
      }
    }
  });

  it('全模式构建加特林与射击闭环', () => {
    const e = fresh();
    e.players[0].elements.Jin = 9;
    for (let i = 0; i < 300; i++) {
      const act = chooseAIAction(e.players[0], e.players[1], e.players, randomBehavior());
      assert(e.isActionFeasible(0, act), 'infeasible: ' + JSON.stringify(act));
    }
  });
});

describe('木系基础攻击', () => {
  it('木之刺：1 木造成 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    const r = e.executeRound(use('Mu', 'attack'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[0].elements.Mu === 0, 'got ' + e.players[0].elements.Mu);
    assert(r.log_message.indexOf('木之刺') !== -1, r.log_message);
  });

  it('木之刺 vs 防御：伤害减为 0', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    const r = e.executeRound(use('Mu', 'attack'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
  });
});

describe('藤蔓束缚平衡', () => {
  it('受击解绑（严格版）：穿甲弹真实伤害挣脱束缚', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), DEF);
    e.players[0].weapons.armorPiercing = 1;
    const r = e.executeRound(use('Jin', 'apFire'), gather('Jin'));
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    assert(r.p2_hp_change === -1, 'AP should pierce defense, got ' + r.p2_hp_change);
    assert(r.log_message.indexOf('挣脱') !== -1, r.log_message);
  });

  it('受击解绑（严格版）：伤害被防御减为 0 时束缚保持', () => {
    const e = fresh();
    e.players[0].elements.Mu = 3;
    e.executeRound(use('Mu', 'bind'), DEF);
    e.players[0].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.bindTurns === 1, 'should only tick down, got ' + e.players[1].status.bindTurns);
  });

  it('金之斩双职：被束缚时可用金之斩解绑并反打 1 伤', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), DEF);
    e.players[1].elements.Jin = 1;
    const r = e.executeRound(gather('Huo'), use('Jin', 'attack'));
    assert(r.forcedChanges.length === 0, JSON.stringify(r.forcedChanges));
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    assert(r.p1_hp_change === -1, 'slash should hit binder, got ' + r.p1_hp_change);
    assert(r.log_message.indexOf('斩断藤蔓') !== -1, r.log_message);
  });

  it('无金时被束缚用金之斩：资源不足被迫防御，束缚保持', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), DEF);
    const r = e.executeRound(DEF, use('Jin', 'attack'));
    assert(r.forcedChanges.length === 1 && r.forcedChanges[0].player === 'p2', JSON.stringify(r.forcedChanges));
    assert(r.actions.p2.type === ACTION.DEFEND, JSON.stringify(r.actions.p2));
    assert(e.players[1].status.bindTurns === 1, 'got ' + e.players[1].status.bindTurns);
  });

  it('束缚中复读上回合的接取：与上回合动作一致则放行', () => {
    const e = fresh();
    e.players[0].elements.Mu = 1;
    e.executeRound(use('Mu', 'bind'), gather('Mu'));
    assert(e.players[1].status.bindTurns === 2, 'got ' + e.players[1].status.bindTurns);
    const r = e.executeRound(gather('Huo'), gather('Mu'));
    assert(r.forcedChanges.length === 0, JSON.stringify(r.forcedChanges));
    assert(e.players[1].elements.Mu === 2, 'repeat gather should succeed, got ' + e.players[1].elements.Mu);
  });

  it('束缚不可叠加：对已束缚目标施放被判不可行，路线不可选', () => {
    const e = fresh();
    e.players[0].elements.Mu = 3;
    e.executeRound(use('Mu', 'bind'), DEF);
    assert(e.players[1].status.bindTurns === 2, 'got ' + e.players[1].status.bindTurns);
    assert(!e.isActionFeasible(0, use('Mu', 'bind')), 'bind on bound target should be infeasible');
    assert(e.getAvailableRoutes(0, 'Mu').indexOf('bind') === -1, 'bind should not be in available routes');
  });

  it('束缚不可叠加：强行提交被强制防御、不耗木、不刷新时长', () => {
    const e = fresh();
    e.players[0].elements.Mu = 3;
    e.executeRound(use('Mu', 'bind'), DEF);
    const r = e.executeRound(use('Mu', 'bind'), gather('Jin'));
    const fc = r.forcedChanges.find(c => c.player === 'p1');
    assert(fc && fc.reason === '目标已被束缚，束缚不可叠加', JSON.stringify(r.forcedChanges));
    assert(r.actions.p1.type === ACTION.DEFEND, JSON.stringify(r.actions.p1));
    assert(e.players[0].elements.Mu === 2, 'failed bind should not consume wood, got ' + e.players[0].elements.Mu);
    assert(r.log_message.indexOf('不可叠加') !== -1, r.log_message);
    assert(e.players[1].status.bindTurns === 1, 'duration must tick down normally, got ' + e.players[1].status.bindTurns);
  });

  it('束缚解除后可再次施放（非永久禁用）', () => {
    const e = fresh();
    e.players[0].elements.Mu = 5;
    e.executeRound(use('Mu', 'bind'), DEF);
    e.executeRound(gather('Mu'), gather('Jin'));
    e.executeRound(gather('Mu'), gather('Jin'));
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    assert(e.getAvailableRoutes(0, 'Mu').indexOf('bind') !== -1, 'bind should be available again');
  });

  it('AI：目标已被束缚时不再选择藤蔓束缚', () => {
    const e = fresh();
    e.players[0].status.bindTurns = 2;
    e.players[1].elements.Mu = 5;
    for (let k = 0; k < 200; k++) {
      const act = chooseAIAction(e.players[1], e.players[0], e.players, 'woodkeeper');
      const isBind = act.type === ACTION.USE && act.element === ELEMENT.MU && act.route === 'bind';
      assert(!isBind, 'AI picked bind on bound target: ' + JSON.stringify(act));
    }
  });
});

describe('多人模式（引擎层）', () => {
  it('构造 3 人局：命名正确、缺省动作自动补防御、报告含 hpChanges', () => {
    const e = new GameEngine(3);
    assert(e.playerCount === 3, 'got ' + e.playerCount);
    assert(e.players.length === 3 && e.players[2].name === 'P3', e.players.map(p => p.name).join(','));
    const r = e.executeRound([gather('Jin'), DEF]);
    assert(r.actions.p3.type === ACTION.DEFEND, JSON.stringify(r.actions.p3));
    assert(Array.isArray(r.hpChanges) && r.hpChanges.length === 3, JSON.stringify(r.hpChanges));
    assert(r.hpChanges.every(v => v === 0), JSON.stringify(r.hpChanges));
  });

  it('火球雨多人分流：每火指定不同目标，各 1 伤且不干扰接取', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Huo = 2;
    const rain = use('Huo', 'fireRain');
    rain.targets = [1, 2];
    const r = e.executeRound(rain, gather('Jin'), gather('Huo'));
    assert(r.hpChanges[1] === -1 && r.hpChanges[2] === -1, JSON.stringify(r.hpChanges));
    assert(e.players[0].elements.Huo === 0, 'rain consumes all fire');
    assert(e.players[1].elements.Jin === 1 && e.players[2].elements.Huo === 1, 'victims still gather');
    assert(r.winner === null, r.winner);
  });

  it('火球雨目标重复：非法 → 强制防御且不消耗火', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Huo = 2;
    const rain = use('Huo', 'fireRain');
    rain.targets = [1, 1];
    const r = e.executeRound(rain, DEF, DEF);
    assert(r.forcedChanges.length === 1 && r.forcedChanges[0].player === 'p1', JSON.stringify(r.forcedChanges));
    assert(r.actions.p1.type === ACTION.DEFEND, JSON.stringify(r.actions.p1));
    assert(e.players[0].elements.Huo === 2, 'should not consume on invalid target');
  });

  it('双枪多人必须指向不同目标；1v1 可集火同一目标', () => {
    const e = new GameEngine(3);
    e.players[0].weapons.hasDualPistols = true;
    e.players[0].elements.Jin = 9;
    const bad = use('Jin', 'dualFire');
    bad.targets = [1, 1];
    assert(!e.isActionFeasible(0, bad), 'same target must be infeasible in 3p');
    const good = use('Jin', 'dualFire');
    good.targets = [1, 2];
    assert(e.isActionFeasible(0, good), 'distinct targets should be feasible');
    const r = e.executeRound(good, gather('Jin'), gather('Jin'));
    assert(r.hpChanges[1] === -1 && r.hpChanges[2] === -1, JSON.stringify(r.hpChanges));

    const e2 = fresh();
    e2.players[0].weapons.hasDualPistols = true;
    e2.players[0].elements.Jin = 1;
    const same = use('Jin', 'dualFire');
    same.targets = [1, 1];
    assert(e2.isActionFeasible(0, same), '1v1 focus fire should stay legal');
  });

  it('加特林集火单一目标（3 人局）', () => {
    const e = new GameEngine(3);
    e.players[0].weapons.hasGatling = true;
    e.players[0].elements.Jin = 2;
    const g = use('Jin', 'gatlingFire', 2);
    g.targets = [2];
    const r = e.executeRound(g, gather('Jin'), gather('Jin'));
    assert(r.hpChanges[1] === 0 && r.hpChanges[2] === -4, JSON.stringify(r.hpChanges));
  });

  it('单体路线可指定目标：火球只命中指定者', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Huo = 1;
    const fb = use('Huo', 'fireball');
    fb.targets = [2];
    const r = e.executeRound(fb, gather('Jin'), gather('Jin'));
    assert(r.hpChanges[1] === 0 && r.hpChanges[2] === -1, JSON.stringify(r.hpChanges));
  });

  it('多人胜负：最后存活者获胜', () => {
    const e = new GameEngine(3);
    e.players[1].hp = 1;
    e.players[2].hp = 1;
    e.players[0].elements.Huo = 2;
    const rain = use('Huo', 'fireRain');
    rain.targets = [1, 2];
    const r = e.executeRound(rain, gather('Jin'), gather('Huo'));
    assert(e.isGameOver, 'game should be over');
    assert(r.winner === 'P1', 'got ' + r.winner);
  });

  it('多人束缚：只锁指定目标，其余玩家正常行动', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 1;
    const b = use('Mu', 'bind');
    b.targets = [2];
    const r = e.executeRound(b, gather('Jin'), gather('Huo'));
    assert(e.players[2].status.bindTurns === 2, 'got ' + e.players[2].status.bindTurns);
    assert(e.players[1].elements.Jin === 1, 'unbound player gathers normally');
    assert(r.hpChanges.every(v => v === 0), JSON.stringify(r.hpChanges));
  });
});

describe('水系', () => {
  it('水弹：1 水造成 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Shui = 1;
    const r = e.executeRound(use('Shui', 'attack'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[0].elements.Shui === 0, 'got ' + e.players[0].elements.Shui);
    assert(r.log_message.indexOf('水弹') !== -1, r.log_message);
  });

  it('渗透：无伤害，次回合末未防御受 1 点穿透伤', () => {
    const e = fresh();
    e.players[0].elements.Shui = 1;
    const r1 = e.executeRound(use('Shui', 'seep'), gather('Jin'));
    assert(r1.p2_hp_change === 0, 'seep should deal no damage, got ' + r1.p2_hp_change);
    assert(e.players[1].status.wetTurns === 1, 'got ' + e.players[1].status.wetTurns);
    const r2 = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r2.p2_hp_change === -1, 'wet tick got ' + r2.p2_hp_change);
    assert(e.players[1].status.wetTurns === 0, 'got ' + e.players[1].status.wetTurns);
    assert(r2.log_message.indexOf('水渍') !== -1, r2.log_message);
  });

  it('渗透判定回合防御：完全规避并清除水渍', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.executeRound(use('Shui', 'seep'), gather('Jin'));
    const r = e.executeRound(gather('Huo'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.wetTurns === 0, 'got ' + e.players[1].status.wetTurns);
    assert(r.log_message.indexOf('驱散') !== -1 && r.log_message.indexOf('水渍') !== -1, r.log_message);
  });

  it('渗透施加当回合防御：不能提前清除水渍', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    const r1 = e.executeRound(use('Shui', 'seep'), DEF);
    assert(e.players[1].status.wetTurns === 1, 'got ' + e.players[1].status.wetTurns);
    const r2 = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r2.p2_hp_change === -1, 'got ' + r2.p2_hp_change);
  });

  it('渗透重复施加：快照结算且不叠层', () => {
    const e = fresh();
    e.players[0].elements.Shui = 9;
    e.executeRound(use('Shui', 'seep'), gather('Jin'));
    assert(e.players[1].status.wetTurns === 1, 'got ' + e.players[1].status.wetTurns);
    // 第 2 回合：旧水渍到判定时点（快照），当回合再次渗透被一并结算消耗，不产生两层
    const r2 = e.executeRound(use('Shui', 'seep'), gather('Jin'));
    assert(r2.p2_hp_change === -1, 'tick exactly once, got ' + r2.p2_hp_change);
    assert(e.players[1].status.wetTurns === 0, 'no lingering stack, got ' + e.players[1].status.wetTurns);
    const r3 = e.executeRound(gather('Jin'), gather('Jin'));
    assert(r3.p2_hp_change === 0, 'nothing left, got ' + r3.p2_hp_change);
  });

  it('冲刷：命中销毁目标金/木/火/土各 1 枚（不动水）', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.players[1].elements.Shui = 3;
    const r = e.executeRound(use('Shui', 'scour'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[1].elements.Jin === 0, 'got ' + e.players[1].elements.Jin);
    assert(e.players[1].elements.Shui === 3, 'water must be untouched, got ' + e.players[1].elements.Shui);
    assert(r.log_message.indexOf('毁去') !== -1, r.log_message);
  });

  it('冲刷 vs 防御：伤害归零且不销毁元素', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.players[1].elements.Jin = 2;
    const r = e.executeRound(use('Shui', 'scour'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].elements.Jin === 2, 'got ' + e.players[1].elements.Jin);
  });

  it('冲刷 vs 荆棘之墙：未命中不销毁，反弹照常', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.players[1].elements.Mu = 4;
    const r = e.executeRound(use('Shui', 'scour'), use('Mu', 'thorn'));
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -1, 'wall reflect got ' + r.p1_hp_change);
    assert(e.players[1].elements.Mu === 2, 'element should survive (after wall cost), got ' + e.players[1].elements.Mu);
  });

  it('岩壳吸伤后仍算命中：冲刷照常销毁元素', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.players[1].elements.Tu = 5;
    e.players[1].status.shellLayers = 2;
    const r = e.executeRound(use('Shui', 'scour'), gather('Shui'));
    assert(r.p2_hp_change === 0, 'shell should absorb, got ' + r.p2_hp_change);
    assert(e.players[1].elements.Tu === 4, 'scour should consume tu, got ' + e.players[1].elements.Tu);
    assert(e.players[1].status.shellLayers === 1, 'got ' + e.players[1].status.shellLayers);
  });

  it('生命之泉：未满血回复 1 点', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    e.players[0].hp = 2;
    const r = e.executeRound(use('Shui', 'spring'), DEF);
    assert(e.players[0].hp === 3 && e.players[0].maxHp === 3, 'got ' + e.players[0].hp + '/' + e.players[0].maxHp);
    assert(r.hpChanges[0] === 1, 'got ' + r.hpChanges[0]);
  });

  it('生命之泉：满血升级上限并回复半点（3 → 3.5/4）', () => {
    const e = fresh();
    e.players[0].elements.Shui = 2;
    const r = e.executeRound(use('Shui', 'spring'), DEF);
    assert(e.players[0].hp === 3.5, 'got ' + e.players[0].hp);
    assert(e.players[0].maxHp === 4, 'got ' + e.players[0].maxHp);
    assert(r.hpChanges[0] === 0.5, 'got ' + r.hpChanges[0]);
  });

  it('生命之泉：上限提升后可回满，5.0 封顶不再成长', () => {
    const e = fresh();
    e.players[0].elements.Shui = 20;
    e.executeRound(use('Shui', 'spring'), DEF); // 3 -> 3.5/4
    e.executeRound(use('Shui', 'spring'), DEF); // 3.5 -> 4/4
    e.executeRound(use('Shui', 'spring'), DEF); // 4 -> 4.5/5
    e.executeRound(use('Shui', 'spring'), DEF); // 4.5 -> 5/5
    const p = e.players[0];
    assert(p.hp === 5 && p.maxHp === 5, 'got ' + p.hp + '/' + p.maxHp);
    const r = e.executeRound(use('Shui', 'spring'), DEF); // 满溢浪费
    assert(p.hp === 5 && p.maxHp === 5, 'got ' + p.hp + '/' + p.maxHp);
    assert(r.log_message.indexOf('满溢') !== -1, r.log_message);
  });

  it('半点血量下胜负判定正确', () => {
    const e = fresh();
    e.players[0].hp = 0.5;
    e.players[1].elements.Huo = 1;
    const r = e.executeRound(gather('Jin'), use('Huo', 'fireball'));
    assert(e.players[0].hp === 0, 'got ' + e.players[0].hp);
    assert(r.winner === 'P2', 'got ' + r.winner);
  });
});

describe('土系', () => {
  it('土弹：1 土造成 1 伤害', () => {
    const e = fresh();
    e.players[0].elements.Tu = 1;
    const r = e.executeRound(use('Tu', 'attack'), gather('Jin'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(r.log_message.indexOf('土弹') !== -1, r.log_message);
  });

  it('岩壳：凝聚层数并在未防御时逐层抵消', () => {
    const e = fresh();
    e.players[1].elements.Tu = 1;
    e.executeRound(gather('Huo'), use('Tu', 'shell'));
    assert(e.players[1].status.shellLayers === 1, 'got ' + e.players[1].status.shellLayers);
    e.players[0].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), gather('Tu'));
    assert(r.p2_hp_change === 0, 'shell should absorb, got ' + r.p2_hp_change);
    assert(e.players[1].status.shellLayers === 0, 'got ' + e.players[1].status.shellLayers);
  });

  it('烈焰爆发打多层岩壳：一次吸收多层', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    e.players[1].status.shellLayers = 5;
    const r = e.executeRound(use('Huo', 'blaze'), gather('Tu'));
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.shellLayers === 2, 'got ' + e.players[1].status.shellLayers);
  });

  it('岩壳上限 5 层：超出浪费', () => {
    const e = fresh();
    e.players[1].elements.Tu = 1;
    e.players[1].status.shellLayers = 5;
    const r = e.executeRound(gather('Huo'), use('Tu', 'shell'));
    assert(e.players[1].status.shellLayers === 5, 'got ' + e.players[1].status.shellLayers);
    assert(r.log_message.indexOf('上限') !== -1, r.log_message);
  });

  it('穿甲弹无视岩壳：不掉层也不被抵消', () => {
    const e = fresh();
    e.players[0].weapons.armorPiercing = 1;
    e.players[1].status.shellLayers = 3;
    const r = e.executeRound(use('Jin', 'apFire'), gather('Tu'));
    assert(r.p2_hp_change === -1, 'got ' + r.p2_hp_change);
    assert(e.players[1].status.shellLayers === 3, 'got ' + e.players[1].status.shellLayers);
  });

  it('选择防御的回合：岩壳不参与结算、不消耗', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    e.players[1].status.shellLayers = 2;
    const r = e.executeRound(use('Huo', 'blaze'), DEF);
    assert(r.p2_hp_change === 0, 'defend immunizes, got ' + r.p2_hp_change);
    assert(e.players[1].status.shellLayers === 2, 'shell preserved, got ' + e.players[1].status.shellLayers);
  });

  it('自伤不吃岩壳：烈焰爆发反噬穿透自身岩壳', () => {
    const e = fresh();
    e.players[0].elements.Huo = 2;
    e.players[0].status.shellLayers = 3;
    e.players[1].status.shellLayers = 3;
    const r = e.executeRound(use('Huo', 'blaze'), DEF);
    assert(r.p1_hp_change === -1, 'recoil bypasses own shell, got ' + r.p1_hp_change);
    assert(e.players[0].status.shellLayers === 3, 'got ' + e.players[0].status.shellLayers);
  });

  it('荆棘岩：本回合免伤并反击 2 点无视防御', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    e.players[1].elements.Tu = 2;
    const r = e.executeRound(use('Huo', 'fireball'), use('Tu', 'thornRock'));
    assert(r.p2_hp_change === 0, 'thorn rock immunizes, got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -2, 'reflect got ' + r.p1_hp_change);
    assert(r.log_message.indexOf('荆棘岩反击') !== -1, r.log_message);
  });

  it('荆棘岩有岩壳时：反弹 3 点并消耗 1 层岩壳', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    e.players[1].elements.Tu = 2;
    e.players[1].status.shellLayers = 2;
    const r = e.executeRound(use('Huo', 'fireball'), use('Tu', 'thornRock'));
    assert(r.p1_hp_change === -3, 'got ' + r.p1_hp_change);
    assert(e.players[1].status.shellLayers === 1, 'got ' + e.players[1].status.shellLayers);
  });

  it('加特林打荆棘岩：每攻击者只反弹 1 次', () => {
    const e = fresh();
    e.players[0].elements.Jin = 3;
    e.players[0].weapons.hasGatling = true;
    e.players[1].elements.Tu = 2;
    const r = e.executeRound(use('Jin', 'gatlingFire', 3), use('Tu', 'thornRock'));
    assert(r.p2_hp_change === 0, 'all bullets blocked, got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -2, 'single reflect only, got ' + r.p1_hp_change);
  });

  it('穿甲弹打荆棘岩：伤害生效且反弹照常触发', () => {
    const e = fresh();
    e.players[0].weapons.armorPiercing = 1;
    e.players[1].elements.Tu = 2;
    const r = e.executeRound(use('Jin', 'apFire'), use('Tu', 'thornRock'));
    assert(r.p2_hp_change === -1, 'AP pierces immunity, got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -2, 'reflect still fires, got ' + r.p1_hp_change);
  });

  it('岩脉共鸣：永久觉醒且每回合开始自动凝聚岩壳（封顶5）', () => {
    const e = fresh();
    e.players[1].elements.Tu = 3;
    const r1 = e.executeRound(gather('Huo'), use('Tu', 'vein'));
    assert(e.players[1].status.hasVein === true, 'no vein');
    const r2 = e.executeRound(gather('Huo'), gather('Tu'));
    assert(e.players[1].status.shellLayers === 1, 'auto shell got ' + e.players[1].status.shellLayers);
    assert(r2.log_message.indexOf('岩脉共鸣涌动') !== -1, r2.log_message);
    e.players[1].status.shellLayers = 5;
    e.executeRound(gather('Huo'), gather('Tu'));
    assert(e.players[1].status.shellLayers === 5, 'capped got ' + e.players[1].status.shellLayers);
  });

  it('岩脉共鸣：防御时反震攻击者 1 点无视防御', () => {
    const e = fresh();
    e.players[1].elements.Tu = 3;
    e.players[1].status.hasVein = true;
    e.players[0].elements.Huo = 1;
    const r = e.executeRound(use('Huo', 'fireball'), DEF);
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -1, 'vein reflect got ' + r.p1_hp_change);
    assert(r.log_message.indexOf('反震') !== -1, r.log_message);
  });

  it('共鸣反震对加特林也每攻击者只结算 1 次', () => {
    const e = fresh();
    e.players[0].elements.Jin = 3;
    e.players[0].weapons.hasGatling = true;
    e.players[1].elements.Tu = 3;
    e.players[1].status.hasVein = true;
    const r = e.executeRound(use('Jin', 'gatlingFire', 3), DEF);
    assert(r.p2_hp_change === 0, 'defended bullets all blocked, got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -1, 'single counter, got ' + r.p1_hp_change);
  });

  it('共鸣与荆棘岩联动：回合开始自动岩壳使反弹提升至 3 点', () => {
    const e = fresh();
    e.players[0].elements.Huo = 1;
    e.players[1].elements.Tu = 9;
    e.players[1].status.hasVein = true;
    const r = e.executeRound(use('Huo', 'fireball'), use('Tu', 'thornRock'));
    assert(r.p2_hp_change === 0, 'got ' + r.p2_hp_change);
    assert(r.p1_hp_change === -3, 'auto-shell boosts thorn rock to 3, got ' + r.p1_hp_change);
    assert(e.players[1].status.shellLayers === 0, 'consumed the auto shell, got ' + e.players[1].status.shellLayers);
  });
});

describe('V4.0 多人平衡（≥3 人局生效）', () => {
  it('冲刷免疫：命中销毁后获 2 回合免疫，免疫期内施放无效不耗水', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Shui = 9;
    e.players[1].elements.Jin = 2;
    e.executeRound(use('Shui', 'scour'), gather('Jin'), DEF);
    assert(e.players[1].status.scourImmuneTurns === 2, 'got ' + e.players[1].status.scourImmuneTurns);
    assert(!e.isActionFeasible(0, use('Shui', 'scour')), 'scour should be blocked by immunity');
    e.players[0].elements.Shui = 7; // 对齐账目：首回合已耗 2 水
    let r = e.executeRound(use('Shui', 'scour'), gather('Jin'), DEF);
    assert(e.players[0].elements.Shui === 7, 'water must not be consumed, got ' + e.players[0].elements.Shui);
    assert(r.forcedChanges.some(c => c.player === 'p1' && c.reason === '目标处于冲刷免疫期'), JSON.stringify(r.forcedChanges));
    assert(r.log_message.indexOf('冲刷免疫期') !== -1, r.log_message);
    assert(e.players[1].status.scourImmuneTurns === 1, 'after R2 got ' + e.players[1].status.scourImmuneTurns);
    r = e.executeRound(gather('Shui'), DEF, DEF);
    assert(e.players[1].status.scourImmuneTurns === 0, 'after R3 got ' + e.players[1].status.scourImmuneTurns);
    r = e.executeRound(gather('Shui'), DEF, DEF); // R4：免疫已过，可再次冲刷
    assert(e.isActionFeasible(0, use('Shui', 'scour')), 'should be scourable again after immunity');
  });

  it('种子免疫：寄生成功后获 2 回合免疫，免疫期内施放无效不耗木', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 9;
    e.players[1].elements.Jin = 1;
    e.executeRound(use('Mu', 'seed'), gather('Jin'), DEF); // R1：附种；P1 补金（确保金是唯一可偷元素）
    assert(e.players[0].elements.Jin === 0, 'no steal on attach round');
    e.executeRound(gather('Huo'), use('Jin', 'attack'), DEF); // R2 末：种子存活 → 偷取 + 授予免疫
    assert(e.players[0].elements.Jin === 1, 'seed should steal the only Jin');
    assert(e.players[1].status.seedImmuneTurns === 2, 'got ' + e.players[1].status.seedImmuneTurns);
    assert(!e.isActionFeasible(0, use('Mu', 'seed')), 'seed should be blocked by immunity');
    const r3 = e.executeRound(use('Mu', 'seed'), DEF, DEF); // R3：免疫期内；P1 防御清除寄生
    assert(r3.forcedChanges.some(c => c.player === 'p1' && c.reason === '目标处于种子免疫期'), JSON.stringify(r3.forcedChanges));
    assert(e.players[0].elements.Mu === 7, 'wood must not be consumed, got ' + e.players[0].elements.Mu);
    assert(e.players[1].status.seedImmuneTurns === 1, 'after R3 got ' + e.players[1].status.seedImmuneTurns);
    e.executeRound(gather('Huo'), gather('Tu'), DEF); // R4 末：免疫归零
    assert(e.players[1].status.seedImmuneTurns === 0, 'after R4 got ' + e.players[1].status.seedImmuneTurns);
    e.executeRound(gather('Huo'), gather('Tu'), DEF); // R5：可再次寄生
    assert(e.isActionFeasible(0, use('Mu', 'seed')), 'should be seedable again after immunity');
  });

  it('免疫独立性：冲刷免疫不影响种子（反之亦然）', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Shui = 9;
    e.players[0].elements.Mu = 9;
    e.players[1].elements.Jin = 3;
    e.executeRound(use('Shui', 'scour'), gather('Jin'), DEF);
    assert(!e.isActionFeasible(0, use('Shui', 'scour')), 'scour blocked');
    assert(e.isActionFeasible(0, { type: ACTION.USE, element: 'Mu', route: 'seed' }), 'seed still allowed');
  });

  it('束缚免疫·挣脱路径：金之斩解绑后 1 回合不可再被束缚', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 9;
    e.executeRound(use('Mu', 'bind'), DEF, DEF);
    e.players[1].elements.Jin = 1;
    e.executeRound(gather('Huo'), use('Jin', 'attack'), DEF);
    assert(e.players[1].status.bindTurns === 0 && e.players[1].status.bindImmuneTurns === 1,
      'bind=' + e.players[1].status.bindTurns + ' imm=' + e.players[1].status.bindImmuneTurns);
    assert(!e.isActionFeasible(0, use('Mu', 'bind')), 'bind should be blocked during immunity');
    e.players[0].elements.Mu = 5;
    const r = e.executeRound(use('Mu', 'bind'), DEF, DEF);
    assert(r.forcedChanges.some(c => c.player === 'p1' && c.reason === '目标处于束缚免疫期'), JSON.stringify(r.forcedChanges));
    assert(e.players[0].elements.Mu === 5, 'wood must not be consumed');
    e.executeRound(gather('Mu'), DEF, DEF);
    assert(e.isActionFeasible(0, use('Mu', 'bind')), 'should be bindable again after immunity');
  });

  it('束缚免疫·自然到期路径：束缚耗尽后同样获得 1 回合免疫', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 9;
    e.executeRound(use('Mu', 'bind'), DEF, DEF);
    e.executeRound(gather('Huo'), DEF, DEF);
    assert(e.players[1].status.bindTurns === 1, 'got ' + e.players[1].status.bindTurns);
    e.executeRound(gather('Huo'), DEF, DEF);
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    assert(e.players[1].status.bindImmuneTurns === 1, 'got ' + e.players[1].status.bindImmuneTurns);
    assert(!e.isActionFeasible(0, use('Mu', 'bind')), 'immunity should block rebinding');
  });

  it('束缚免疫·受击断裂路径：穿甲弹打醒后获得免疫', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 9;
    e.executeRound(use('Mu', 'bind'), DEF, DEF);
    e.players[0].weapons.armorPiercing = 1;
    e.executeRound(use('Jin', 'apFire'), DEF, DEF);
    assert(e.players[1].status.bindTurns === 0, 'got ' + e.players[1].status.bindTurns);
    assert(e.players[1].status.bindImmuneTurns === 1, 'got ' + e.players[1].status.bindImmuneTurns);
  });

  it('穿甲弹命中荆棘岩：正常伤害 + 震落 1 层岩壳 + 反弹照常', () => {
    const e = new GameEngine(3);
    e.players[0].weapons.armorPiercing = 1;
    e.players[1].elements.Tu = 2;
    e.players[1].status.shellLayers = 1; // AP 震落这层后，反伤按无壳计算
    const r = e.executeRound(use('Jin', 'apFire'), use('Tu', 'thornRock'), DEF);
    assert(e.players[1].hp === 2, 'AP should damage rock owner, got ' + e.players[1].hp);
    assert(e.players[1].status.shellLayers === 0, 'shell should drop to 0, got ' + e.players[1].status.shellLayers);
    assert(e.players[0].hp === 1, 'rock reflect 2 (no shell boost) to attacker, got ' + e.players[0].hp);
    assert(r.log_message.indexOf('震落') !== -1, r.log_message);
  });

  it('穿甲弹击碎荆棘之墙：伤害+1、无反弹、压制该目标反伤（战报标记）', () => {
    const e = new GameEngine(3);
    e.players[0].elements.Mu = 2;
    e.players[1].elements.Huo = 1;
    e.players[2].weapons.armorPiercing = 1;
    const r = e.executeRound(use('Mu', 'thorn'), use('Huo', 'fireball'), use('Jin', 'apFire'));
    assert(e.players[0].hp === 1, 'wall owner takes 2 from shattered AP (no fireball dmg), got ' + e.players[0].hp);
    assert(e.players[1].hp === 2, 'fireball reflected by wall, got ' + e.players[1].hp);
    assert(e.players[2].hp === 3, 'AP shatter triggers no reflect, got ' + e.players[2].hp);
    assert(r.log_message.indexOf('压制了') !== -1, r.log_message);
  });

  it('V3.1 保持：1v1 局不受多人平衡影响（无免疫期）', () => {
    const e = new GameEngine(2);
    e.players[0].elements.Shui = 9;
    e.players[0].elements.Mu = 9;
    e.players[1].elements.Jin = 3;
    e.executeRound(use('Shui', 'scour'), gather('Jin'));
    assert(e.players[1].status.scourImmuneTurns === 0, 'no scour immunity in 1v1');
    assert(e.isActionFeasible(0, use('Shui', 'scour')), 'consecutive scour allowed in 1v1');
    e.executeRound(use('Mu', 'bind'), DEF);
    assert(e.players[1].status.bindTurns > 0, 'bind should apply in 1v1');
    e.players[1].elements.Jin = Math.max(1, e.players[1].elements.Jin);
    e.executeRound(gather('Huo'), use('Jin', 'attack'));
    assert(e.players[1].status.bindTurns === 0, 'escaped by slash, got ' + e.players[1].status.bindTurns);
    assert(e.players[1].status.bindImmuneTurns === 0, 'no bind immunity in 1v1');
    assert(e.isActionFeasible(0, use('Mu', 'bind')), 'rebind allowed immediately in 1v1');
  });

  it('submitAction/runTurn API：凑齐动作后统一结算，死亡玩家免提交', () => {
    const e = new GameEngine(3);
    e.submitAction(0, gather('Jin'));
    e.submitAction(2, DEF);
    assert(!e.allActionsSubmitted(), 'missing seat 1');
    e.submitAction(1, gather('Mu'));
    assert(e.allActionsSubmitted(), 'all submitted');
    const rep = e.runTurn();
    assert(e.players[0].elements.Jin === 1 && e.players[1].elements.Mu === 1, 'gathers applied');
    assert(rep.actions.p1.element === 'Jin' || rep.actions.p2.element === 'Mu', 'report present');

    e.nextRound();
    e.players[1].hp = 0;
    e.submitAction(0, DEF);
    e.submitAction(2, DEF);
    assert(e.allActionsSubmitted(), 'dead player exempt from submitting');
  });
});

for (const g of groups) {
  console.log(g.title);
  for (const t of g.tests) {
    if (t.skip) {
      skipped += 1;
      console.log('  \u23ED SKIP ' + t.name);
      continue;
    }
    try {
      t.fn();
      passed += 1;
      console.log('  \u2713 ' + t.name);
    } catch (err) {
      failed += 1;
      console.error('  \u2717 ' + t.name + '  [' + (err && err.message) + ']');
    }
  }
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed === 0 ? 0 : 1);
