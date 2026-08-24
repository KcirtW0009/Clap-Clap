'use strict';

const engine = new GameEngine();

let selections = { p1: null, p2: null };
let resolving = false;
let aiTimer = null;
let roundCount = 1;
let aiBehavior = randomBehavior();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ELEMENT_ICON = { Jin: '金', Mu: '木', Shui: '水', Huo: '火', Tu: '土' };

const ELEMENT_GLOW = {
  Jin: 'rgba(251,191,36,0.9)',
  Mu: 'rgba(52,211,153,0.9)',
  Shui: 'rgba(56,189,248,0.9)',
  Huo: 'rgba(251,113,133,0.9)',
  Tu: 'rgba(176,137,104,0.9)'
};

const ROUTE_COST = {
  'Jin.attack': '耗1金 · 1伤',
  'Jin.craftGatling': '耗1金 · 获得加特林',
  'Jin.gatlingFire': '耗N金 · 2N发子弹',
  'Jin.craftDual': '耗1金 · 获得双枪',
  'Jin.dualFire': '耗1金 · 2伤',
  'Jin.craftAP': '耗1金 · 获得穿甲弹',
  'Jin.apFire': '耗1穿甲弹 · 1伤（无视防御；击碎荆棘之墙时提升为 2）',
  'Mu.attack': '耗1木 · 1伤',
  'Mu.bind': '耗1木 · 束缚2回合（受击/金之斩可解 · 已束缚者免疫）',
  'Mu.seed': '耗2木 · 1伤+偷元素',
  'Mu.thorn': '耗2木 · 免疫+反弹1',
  'Huo.fireball': '耗1火 · 1伤',
  'Huo.fireRain': '耗全部火 · 1伤',
  'Huo.blaze': '耗2火 · 3伤+自伤1',
  'Huo.burn': '耗2火 · 1伤+灼烧2回合',
  'Shui.attack': '耗1水 · 1伤',
  'Shui.seep': '耗1水 · 水渍：次回合末未防御则受1穿透伤',
  'Shui.scour': '耗2水 · 1伤，命中则毁其1枚金/木/火/土',
  'Shui.spring': '耗2水 · 回复1；满血则上限+1(至5)并回复0.5',
  'Tu.attack': '耗1土 · 1伤',
  'Tu.shell': '耗1土 · 岩壳+1层(至5)，未防御时每层挡1伤',
  'Tu.thornRock': '耗2土 · 本回合免伤，反噬攻击者2伤(有岩壳3伤并耗1层)',
  'Tu.vein': '耗3土 · 永久：每回合自动+1岩壳，防御时反震1伤'
};

function canAct() {
  return engine.state === STATE.READY && !resolving;
}

function init() {
  $('#btn-gather').addEventListener('click', () => {
    if (!canAct()) return;
    const bound = isBoundP1();
    const last = engine.players[0].status.lastAction;
    const repeatGather = bound && last && last.type === ACTION.GATHER;
    $$('#gather-panel .el-btn').forEach(btn => {
      btn.disabled = bound && (!repeatGather || btn.dataset.el !== last.element);
    });
    if (bound && !repeatGather) return;
    openPanel('gather-panel');
  });
  $('#gather-cancel').addEventListener('click', () => closePanel('gather-panel'));
  $$('#gather-panel .el-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!canAct()) return;
      closePanel('gather-panel');
      commitAction({ type: ACTION.GATHER, element: btn.dataset.el });
    });
  });

  $('#btn-use').addEventListener('click', () => {
    if (!canAct()) return;
    openUsePanel();
  });
  $('#use-cancel').addEventListener('click', () => closePanel('use-panel'));
  $('#amount-cancel').addEventListener('click', () => {
    closePanel('amount-panel');
    openUsePanel();
  });

  $$('[data-action="defend"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!canAct()) return;
      closeAllPanels();
      commitAction({ type: ACTION.DEFEND });
    });
  });

  $('#next-btn').addEventListener('click', nextRound);
  $('#restart-btn').addEventListener('click', restartGame);

  renderAll();
}

function openPanel(id) {
  closeAllPanels();
  $('#' + id).hidden = false;
}

function closePanel(id) {
  $('#' + id).hidden = true;
}

function closeAllPanels() {
  $('#gather-panel').hidden = true;
  $('#use-panel').hidden = true;
  $('#amount-panel').hidden = true;
}

function boundAllowedRoutes() {
  const allowed = new Set(['Jin.attack']);
  const last = engine.players[0].status.lastAction;
  if (last && last.type === ACTION.USE) allowed.add(last.element + '.' + last.route);
  return allowed;
}

function openUsePanel() {
  const list = $('#route-list');
  list.innerHTML = '';
  const bound = isBoundP1();
  const allowed = bound ? boundAllowedRoutes() : null;
  let shown = 0;
  for (const el of ['Jin', 'Mu', 'Shui', 'Huo', 'Tu']) {
    const entries = [];
    for (const route of Object.keys(ROUTES[el])) {
      if (allowed && !allowed.has(el + '.' + route)) continue;
      const feasible = route === 'gatlingFire'
        ? engine.players[0].weapons.hasGatling && engine.players[0].elements.Jin >= 1
        : engine.isActionFeasible(0, { type: ACTION.USE, element: el, route });
      if (!feasible) continue;
      entries.push(route);
    }
    if (entries.length === 0) continue;
    shown += entries.length;

    const header = document.createElement('div');
    header.className = 'route-group el-' + el.toLowerCase();
    header.textContent = ELEMENT_ICON[el];
    list.appendChild(header);

    for (const route of entries) {
      const btn = document.createElement('button');
      btn.className = 'route-btn el-' + el.toLowerCase();
      btn.dataset.el = el;
      btn.dataset.route = route;
      btn.innerHTML =
        '<span class="route-name">' + ROUTES[el][route].name + '</span>' +
        '<span class="route-cost">' + (ROUTE_COST[el + '.' + route] || '') + '</span>';
      btn.addEventListener('click', () => {
        if (!canAct()) return;
        closePanel('use-panel');
        if (route === 'gatlingFire') {
          const last = engine.players[0].status.lastAction;
          if (bound && last && last.element === el && last.route === 'gatlingFire' && last.amount >= 1) {
            commitAction({ type: ACTION.USE, element: el, route, amount: last.amount });
          } else {
            openAmountPanel(el);
          }
        } else {
          commitAction({ type: ACTION.USE, element: el, route });
        }
      });
      list.appendChild(btn);
    }
  }
  if (shown === 0) {
    const hint = document.createElement('div');
    hint.className = 'route-group';
    hint.textContent = bound ? '无可用挣脱/复读动作，请选择防御' : '暂无可用路线';
    list.appendChild(hint);
  }
  openPanel('use-panel');
}

function openAmountPanel(el) {
  const list = $('#amount-list');
  list.innerHTML = '';
  const max = Math.min(engine.players[0].elements.Jin, 3);
  for (let n = 1; n <= max; n++) {
    const btn = document.createElement('button');
    btn.className = 'route-btn el-jin';
    btn.innerHTML =
      '<span class="route-name">射击 ' + 2 * n + ' 发</span>' +
      '<span class="route-cost">耗 ' + n + ' 金</span>';
    btn.addEventListener('click', () => {
      if (!canAct()) return;
      closePanel('amount-panel');
      commitAction({ type: ACTION.USE, element: el, route: 'gatlingFire', amount: n });
    });
    list.appendChild(btn);
  }
  openPanel('amount-panel');
}

function commitAction(actionObj) {
  if (!canAct()) return;

  selections.p1 = actionObj;
  $('#action-label-0').textContent = '已选择：' + formatAction(actionObj);
  renderControls();
  scheduleAI();
}

function scheduleAI() {
  if (aiTimer) return;
  setStatus('对手思考中...');
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (resolving) return;
    selections.p2 = chooseAIAction(engine.players[1], engine.players[0], engine.players, aiBehavior);
    $('#action-label-1').textContent = '已选择：' + formatAction(selections.p2);
    lockAndResolve();
  }, 500);
}

function lockAndResolve() {
  resolving = true;
  setStatus('结算中...');
  $('#status-text').classList.add('pulsing');
  $('#btn-gather').disabled = true;
  $('#btn-use').disabled = true;
  $$('[data-action="defend"]').forEach(b => (b.disabled = true));
  closeAllPanels();

  const result = engine.executeRound(selections.p1, selections.p2);
  playRoundAnimations(result);

  setTimeout(() => {
    showResult(result);
  }, 900);
}

function playRoundAnimations(result) {
  animatePlayerAction(0, result.actions.p1);
  animatePlayerAction(1, result.actions.p2);
  if (result.p2_hp_change < 0) hurtFlash(1);
  if (result.p1_hp_change < 0) hurtFlash(0);
}

function animatePlayerAction(idx, act) {
  if (act.type === ACTION.USE) {
    const el = act.element || 'Jin';
    switch (act.route) {
      case 'craftGatling':
      case 'craftDual':
      case 'craftAP':
        spawnCraft(idx);
        break;
      case 'attack':
        spawnProjectileFx(idx, 1 - idx, el, { cls: 'fx-blade' });
        punchCharacter(idx);
        break;
      case 'gatlingFire':
        spawnBullets(idx, 1 - idx, 2 * (act.amount || 1), el, 13, 55);
        punchCharacter(idx);
        break;
      case 'dualFire':
        spawnBullets(idx, 1 - idx, 2, el, 18, 25);
        punchCharacter(idx);
        break;
      case 'apFire':
        spawnAPRound(idx, 1 - idx);
        punchCharacter(idx);
        break;
      case 'fireball':
        spawnProjectileFx(idx, 1 - idx, el, { cls: 'fx-fireball' });
        punchCharacter(idx);
        break;
      case 'fireRain':
        spawnBullets(idx, 1 - idx, 5, el, 15, 50);
        punchCharacter(idx);
        break;
      case 'blaze':
        spawnBurst(1 - idx);
        punchCharacter(idx);
        break;
      case 'burn':
        spawnProjectileFx(idx, 1 - idx, el, { cls: 'fx-fireball' });
        spawnFlame(1 - idx);
        punchCharacter(idx);
        break;
      case 'bind':
        spawnVines(1 - idx);
        break;
      case 'seed':
        spawnProjectileFx(idx, 1 - idx, el, { cls: 'fx-seed' });
        spawnGrow(1 - idx);
        break;
      case 'thorn':
        spawnWall(idx);
        break;
      case 'seep':
        spawnProjectileFx(idx, 1 - idx, el, { cls: 'fx-droplet' });
        spawnWet(1 - idx);
        break;
      case 'scour':
        spawnScour(1 - idx);
        punchCharacter(idx);
        break;
      case 'spring':
        spawnSpring(idx);
        break;
      case 'shell':
        spawnShellFx(idx);
        break;
      case 'thornRock':
        spawnThornRock(idx);
        break;
      case 'vein':
        spawnVeinFx(idx);
        break;
      default:
        spawnProjectileFx(idx, 1 - idx, el, {});
        punchCharacter(idx);
    }
  } else if (act.type === ACTION.DEFEND) {
    spawnShield(idx);
  } else if (act.type === ACTION.GATHER) {
    spawnGather(idx, act.element);
  }
}

function punchCharacter(idx) {
  const el = $(`#player-${idx} .character`);
  el.classList.remove('punching');
  void el.offsetWidth;
  el.classList.add('punching');
  el.addEventListener('animationend', () => el.classList.remove('punching'), { once: true });
}

function hurtFlash(idx) {
  const el = $(`#player-${idx} .character`);
  el.classList.remove('hurt');
  void el.offsetWidth;
  el.classList.add('hurt');
  el.addEventListener('animationend', () => el.classList.remove('hurt'), { once: true });
}

function spawnProjectileFx(fromIdx, toIdx, element, opts) {
  const layer = $('#fx-layer');
  const rect = layer.getBoundingClientRect();
  const from = getAnchor(fromIdx);
  const to = getAnchor(toIdx);
  const glow = ELEMENT_GLOW[element] || 'rgba(255,255,255,0.9)';
  const el = document.createElement('div');
  el.className = 'projectile ' + ((opts && opts.cls) || '');
  el.style.background = 'radial-gradient(circle at 35% 30%, #ffffff, ' + glow + ')';
  el.style.boxShadow = '0 0 18px ' + glow + ', 0 0 6px rgba(255,255,255,0.6)';
  if (opts && opts.size) {
    el.style.width = opts.size + 'px';
    el.style.height = opts.size + 'px';
  }
  const dx = (opts && opts.dx) || 0;
  const dy = (opts && opts.dy) || 0;
  el.style.setProperty('--x1', from.cx - rect.left + 'px');
  el.style.setProperty('--y1', from.cy - rect.top + 'px');
  el.style.setProperty('--x2', to.cx + dx - rect.left + 'px');
  el.style.setProperty('--y2', to.cy + dy - rect.top + 'px');
  if (opts && opts.delay) el.style.animationDelay = opts.delay + 'ms';
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function spawnBullets(fromIdx, toIdx, count, element, size, stagger) {
  for (let k = 0; k < count; k++) {
    spawnProjectileFx(fromIdx, toIdx, element, {
      cls: 'fx-bullet',
      size,
      delay: k * stagger,
      dx: Math.random() * 20 - 10,
      dy: Math.random() * 30 - 15
    });
  }
}

function spawnAPRound(fromIdx, toIdx) {
  const layer = $('#fx-layer');
  const rect = layer.getBoundingClientRect();
  const from = getAnchor(fromIdx);
  const to = getAnchor(toIdx);
  const el = document.createElement('div');
  el.className = 'projectile fx-ap';
  el.style.setProperty('--x1', from.cx - rect.left + 'px');
  el.style.setProperty('--y1', from.cy - rect.top + 'px');
  el.style.setProperty('--x2', to.cx - rect.left + 'px');
  el.style.setProperty('--y2', to.cy - rect.top + 'px');
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function spawnAt(cls, idx, opts) {
  const layer = $('#fx-layer');
  const rect = layer.getBoundingClientRect();
  const a = getAnchor(idx);
  const el = document.createElement('div');
  el.className = cls;
  el.style.left = a.cx - rect.left + 'px';
  el.style.top = a.cy - rect.top + 'px';
  if (opts && opts.delay) el.style.animationDelay = opts.delay + 'ms';
  layer.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function spawnBurst(idx) { spawnAt('fx-burst', idx); }
function spawnFlame(idx) { spawnAt('fx-flame', idx); }
function spawnVines(idx) { spawnAt('fx-vines', idx); }
function spawnGrow(idx) { spawnAt('fx-grow', idx); }
function spawnWall(idx) { spawnAt('fx-wall', idx); }
function spawnWet(idx) { spawnAt('fx-wet', idx); }
function spawnScour(idx) { spawnAt('fx-scour', idx); }
function spawnSpring(idx) { spawnAt('fx-spring', idx); }
function spawnShellFx(idx) { spawnAt('fx-shell', idx); }
function spawnThornRock(idx) { spawnAt('fx-thornrock', idx); }
function spawnVeinFx(idx) { spawnAt('fx-vein', idx); }

function spawnCraft(idx) {
  const layer = $('#fx-layer');
  const rect = layer.getBoundingClientRect();
  const a = getAnchor(idx);
  for (let k = 0; k < 7; k++) {
    const el = document.createElement('div');
    el.className = 'fx-craft';
    el.style.left = a.cx - rect.left + (Math.random() * 64 - 32) + 'px';
    el.style.top = a.cy - rect.top + (Math.random() * 40 - 20) + 'px';
    el.style.animationDelay = k * 70 + 'ms';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
  const label = document.createElement('div');
  label.className = 'craft-label';
  label.textContent = '铸造';
  label.style.left = a.cx - rect.left + 'px';
  label.style.top = a.cy - rect.top + 'px';
  layer.appendChild(label);
  label.addEventListener('animationend', () => label.remove(), { once: true });
}

function getAnchor(idx) {
  const rect = $(`#player-${idx} .character`).getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}

function spawnShield(idx) {
  const el = document.createElement('div');
  el.className = 'shield';
  $(`#player-${idx}`).appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function spawnGather(idx, element) {
  const el = document.createElement('div');
  el.className = 'gather-float';
  el.textContent = ELEMENT_ICON[element] + ' +1';
  el.style.color = ELEMENT_GLOW[element] || '#fff';
  $(`#player-${idx}`).appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function showResult(result) {
  resolving = false;
  $('#status-text').classList.remove('pulsing');

  renderAll();

  $('#action-label-0').textContent = '已选择：' + formatAction(result.actions.p1);
  $('#action-label-1').textContent = '已选择：' + formatAction(result.actions.p2);

  if (result.winner) {
    setStatus(result.winner === '平局' ? '平局！' : result.winner + ' 获胜！');
  } else {
    setStatus('本回合结算完毕');
  }

  const reportEl = $('#report');
  reportEl.innerHTML = '';
  result.log_message.split('\n').forEach(line => {
    const div = document.createElement('div');
    div.className = 'report-line' + reportLineClass(line);
    div.textContent = line;
    reportEl.appendChild(div);
  });
  reportEl.hidden = false;

  const nextBtn = $('#next-btn');
  if (result.winner) {
    nextBtn.hidden = true;
    showModal(result.winner);
  } else {
    nextBtn.disabled = false;
    nextBtn.hidden = false;
    nextBtn.textContent = '下一回合';
  }
}

function reportLineClass(line) {
  if (line.includes('受到') || line.includes('反弹') || line.includes('侵蚀') || line.includes('反击') || line.includes('反震') || line.includes('水渍渗透')) return ' line-damage';
  if (line.includes('防御')) return ' line-defend';
  if (line.includes('接取') || line.includes('铸造') || line.includes('成功') || line.includes('岩壳') || line.includes('共鸣') || line.includes('生命之泉')) return ' line-gain';
  if (line.includes('束缚')) return ' line-bind';
  if (line.includes('种子') || line.includes('窃取')) return ' line-seed';
  if (line.includes('冲刷') || line.includes('毁去')) return ' line-seed';
  if (line.includes('击碎') || line.includes('被迫') || line.includes('打断') || line.includes('荆棘岩')) return ' line-warn';
  return '';
}

function showModal(winner) {
  $('#modal-title').textContent = winner === '平局' ? '平局！' : winner + ' 获胜！';
  $('#modal-overlay').hidden = false;
}

function isBoundP1() {
  return engine.players[0].status.bindTurns > 0;
}

function nextRound() {
  engine.nextRound();
  roundCount += 1;
  resetRoundUI();
  setStatus('请选择动作');
  renderAll();
}

function restartGame() {
  engine.reset();
  aiBehavior = randomBehavior();
  roundCount = 1;
  resetRoundUI();
  $('#modal-overlay').hidden = true;
  setStatus('请选择动作');
  renderAll();
}

function resetRoundUI() {
  selections = { p1: null, p2: null };
  aiTimer = null;
  resolving = false;

  $$('.player-action').forEach(el => (el.textContent = '等待选择...'));
  closeAllPanels();
  $('#next-btn').hidden = true;
  $('#report').hidden = true;

  $('#fx-layer').innerHTML = '';
  $$('.shield').forEach(el => el.remove());
  $$('.gather-float').forEach(el => el.remove());
  $$('.character.charging').forEach(el => el.classList.remove('charging'));
  $$('.character.punching').forEach(el => el.classList.remove('punching'));
  $$('.character.hurt').forEach(el => el.classList.remove('hurt'));

  renderControls();
}

function renderAll() {
  renderPlayer(0);
  renderPlayer(1);
  renderControls();
  $('#round-info').textContent = '回合 ' + roundCount;
  $('#ai-tag').textContent = 'AI · ' + BEHAVIOR_LABEL[aiBehavior];
}

function renderPlayer(idx) {
  const player = engine.players[idx];

  const heartsBox = $(`#hp-${idx}`);
  heartsBox.innerHTML = '';
  for (let i = 0; i < player.maxHp; i += 1) {
    const h = document.createElement('span');
    const remain = player.hp - i;
    h.className = 'heart' + (remain <= 0 ? ' empty' : (remain < 1 ? ' half' : ''));
    heartsBox.appendChild(h);
  }
  const numEl = $(`#hp-num-${idx}`);
  numEl.textContent = fmtHp(player.hp) + '/' + fmtHp(player.maxHp);
  numEl.classList.toggle('low', player.hp <= 1);

  $$('.el-chip', $(`#elements-${idx}`)).forEach(chip => {
    const count = player.elements[chip.dataset.el];
    $('.el-count', chip).textContent = count;
    chip.classList.toggle('has', count > 0);
  });

  const w = player.weapons;
  const wpRow = $(`#weapons-${idx}`);
  wpRow.hidden = !(w.hasGatling || w.hasDualPistols || w.armorPiercing > 0);
  $(`#w-gatling-${idx}`).classList.toggle('on', w.hasGatling);
  $(`#w-dual-${idx}`).classList.toggle('on', w.hasDualPistols);
  const apChip = $(`#w-ap-${idx}`);
  apChip.textContent = '穿甲弹 ×' + w.armorPiercing;
  apChip.classList.toggle('on', w.armorPiercing > 0);

  const st = player.status;
  const chips = $(`#status-chips-${idx}`);
  chips.innerHTML = '';
  if (st.bindTurns > 0) chips.appendChild(statusChip('束缚', 'st-bind'));
  if (st.burnTurns > 0) chips.appendChild(statusChip('灼烧', 'st-burn'));
  if (st.seedTurns > 0) chips.appendChild(statusChip('寄生', 'st-seed'));
  if (st.wetTurns > 0) chips.appendChild(statusChip('水渍', 'st-wet'));
  if (st.shellLayers > 0) chips.appendChild(statusChip('岩壳 ×' + st.shellLayers, 'st-shell'));
  if (st.hasVein) chips.appendChild(statusChip('岩脉共鸣', 'st-vein'));
  $(`#status-${idx}`).hidden = chips.childNodes.length === 0;
}

function fmtHp(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

const STATUS_TIPS = Object.freeze({
  'st-bind':  '束缚：只能防御、复读上回合动作或用金之斩挣脱，持续2回合',
  'st-burn':  '灼烧：每回合末受到1点伤害，防御可驱散',
  'st-seed':  '寄生：每回合末被偷取1枚随机元素，防御可驱散',
  'st-wet':   '水渍：次回合末若未防御则受到1点穿透伤害',
  'st-shell': '岩壳：未防御时每层可抵消1点伤害',
  'st-vein':  '岩脉共鸣：永久——每回合自动凝聚岩壳；防御时反震攻击者1点',
  'st-immune-scour': '免疫冲刷：冲刷对该目标无效，持续剩余回合',
  'st-immune-seed':  '免疫种子：种子寄生对该目标无效，持续剩余回合',
  'st-immune-bind':  '免疫束缚：藤蔓束缚对该目标无效，持续剩余回合'
});

function statusChip(text, cls) {
  const chip = document.createElement('span');
  chip.className = 'status-chip ' + cls;
  chip.textContent = text;
  const tipKey = cls.split(' ')[0];
  if (STATUS_TIPS[tipKey]) chip.title = STATUS_TIPS[tipKey];
  return chip;
}

function renderControls() {
  const locked = engine.state !== STATE.READY || resolving;
  const bound = isBoundP1();
  const last = bound ? engine.players[0].status.lastAction : null;

  $('#btn-gather').disabled = locked || (bound && !(last && last.type === ACTION.GATHER));
  $('#btn-use').disabled = locked;
  $$('[data-action="defend"]').forEach(b => (b.disabled = locked));

  if (!locked && bound) {
    setStatus('你被藤蔓束缚：只能防御、复读上回合动作，或用金之斩挣脱');
  }
}

function setStatus(text) {
  $('#status-text').textContent = text;
}

init();
