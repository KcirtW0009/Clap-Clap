'use strict';

/* global Colyseus, ACTION, ROUTES, GATHERABLE_ELEMENTS, GameEngine, formatAction */

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const REJOIN_KEY = 'cc-rejoin-v5';

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
    'Jin.apFire': '耗1穿甲弹 · 2伤（无视防御；命中荆棘之墙则击碎之）',
    'Mu.attack': '耗1木 · 1伤',
    'Mu.bind': '耗1木 · 束缚2回合（受击/金之斩可解 · 已束缚者免疫）',
    'Mu.seed': '耗2木 · 1伤+偷元素',
    'Mu.thorn': '耗2木 · 免疫+反弹1',
    'Huo.fireball': '耗1火 · 1伤',
    'Huo.fireRain': '耗全部火 · 每目标1伤',
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

  const NO_TARGET_ROUTES = new Set([
    'Jin.craftGatling', 'Jin.craftDual', 'Jin.craftAP',
    'Mu.thorn', 'Shui.spring', 'Tu.shell', 'Tu.thornRock', 'Tu.vein'
  ]);

  let client = null;
  let room = null;
  let me = { seat: -1, role: '', isHost: false };
  let mirror = null;
  let viewPlayers = [];
  let hostSeats = new Set();
  let phase = 'lobby';
  let roundNo = 0;
  let locked = false;
  let submittedLabel = '';
  let deadlineTimer = null;
  let resolveTimer = null;
  let targetCfg = null;
  let targetSelected = [];
  let leavingByIntent = false;
  let expandedSeat = -1;  // V4.1 聚焦模式：当前展开的对手座位（-1=无）

  function show(name) {
    $('#screen-connect').hidden = name !== 'connect';
    $('#screen-waiting').hidden = name !== 'waiting';
    $('#screen-game').hidden = name !== 'game';
    if (name !== 'game') closeModal();
  }

  function setConn(text, cls) {
    const el = $('#conn-chip');
    el.textContent = text;
    el.className = 'conn-chip' + (cls ? ' ' + cls : '');
  }

  function setStatus(text, pulsing) {
    const el = $('#status-text');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('pulsing', !!pulsing);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtHp(v) {
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }

  function ensureClient() {
    if (!client) client = new Colyseus.Client(location.protocol.replace('http', 'ws') + '//' + location.host);
    return client;
  }

  function getName() {
    return ($('#input-name').value.trim() || '无名侠客').slice(0, 12);
  }

  function saveRejoin() {
    if (!room || !room.reconnectionToken) return;
    try {
      sessionStorage.setItem(REJOIN_KEY, JSON.stringify({
        roomId: room.roomId,
        token: room.reconnectionToken
      }));
    } catch (e) { /* noop */ }
    $('#btn-rejoin').hidden = false;
  }

  function clearRejoin() {
    try { sessionStorage.removeItem(REJOIN_KEY); } catch (e) { /* noop */ }
    $('#btn-rejoin').hidden = true;
  }

  function failTip(text) {
    $('#connect-err').textContent = text;
  }

  async function createRoom() {
    failTip('');
    setConn('创建中…');
    try {
      room = await ensureClient().create('clash', {
        name: getName(),
        maxPlayers: Number($('#select-max').value) || 2
      });
      saveRejoin();
      bindRoom();
    } catch (err) {
      setConn('连接失败', 'err');
      failTip('无法连接服务器：' + (err && err.message));
    }
  }

  async function joinByCode(spectateOverride) {
    const code = $('#input-code').value.trim();
    if (!code) { failTip('请输入房间号'); return; }
    failTip('');
    const spectate = spectateOverride != null ? spectateOverride : $('#chk-spectate').checked;
    setConn('加入中…');
    try {
      room = await ensureClient().joinById(code, { name: getName(), spectate });
      saveRejoin();
      bindRoom();
    } catch (err) {
      setConn('连接失败', 'err');
      failTip('加入失败：' + (err && err.message));
    }
  }

  async function joinListed(roomId, spectate) {
    failTip('');
    setConn('加入中…');
    try {
      room = await ensureClient().joinById(roomId, { name: getName(), spectate });
      saveRejoin();
      bindRoom();
    } catch (err) {
      setConn('连接失败', 'err');
      failTip('加入失败：' + (err && err.message));
    }
  }

  async function rejoinLast() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(REJOIN_KEY)); } catch (e) { /* noop */ }
    if (!saved || !saved.token) { clearRejoin(); return; }
    failTip('');
    setConn('重连中…');
    try {
      room = await ensureClient().reconnect(saved.token);
      saveRejoin();
      bindRoom();
    } catch (err) {
      clearRejoin();
      setConn('重连失败', 'err');
      failTip('上一局已无法恢复（可能已结束）：' + (err && err.message));
    }
  }

  function leaveRoom() {
    if (room) {
      leavingByIntent = true;
      try { room.leave(); } catch (e) { /* noop */ }
    }
    cleanup();
    setConn('未连接');
    show('connect');
  }

  function cleanup() {
    stopDeadline();
    if (resolveTimer) { clearTimeout(resolveTimer); resolveTimer = null; }
    room = null;
    mirror = null;
    viewPlayers = [];
    hostSeats = new Set();
    phase = 'lobby';
    roundNo = 0;
    locked = false;
    submittedLabel = '';
    targetCfg = null;
    targetSelected = [];
    leavingByIntent = false;
    expandedSeat = -1;
    me = { seat: -1, role: '', isHost: false };
    closeModal();
  }

  function bindRoom() {
    room.onMessage('welcome', (m) => {
      me.role = m.role || 'player';
      me.seat = typeof m.seat === 'number' ? m.seat : -1;
      me.isHost = !!m.isHost;
      setConn(me.role === 'spectator' ? '已连接 · 观战' : '已连接 · 座位 ' + (m.seat + 1), 'ok');
      if (!m.resumed) show('waiting');
    });

    room.onMessage('roomInfo', (m) => {
      hostSeats = new Set((m.players || []).filter(p => p.isHost).map(p => p.seat));
      renderWaiting(m);
      if (m.phase === 'lobby' && !$('#screen-game').hidden && phase !== 'lobby') backToWaiting();
    });

    room.onMessage('started', (m) => {
      phase = 'playing';
      startGameView(m);
    });

    room.onMessage('sync', (m) => {
      phase = m.phase === 'ended' ? 'ended' : 'playing';
      syncFromSnapshot(m);
    });

    room.onMessage('report', (m) => {
      stopDeadline();
      locked = true;
      playRoundFx(m);
      if (resolveTimer) clearTimeout(resolveTimer);
      resolveTimer = setTimeout(() => applyReport(m), 900);
    });

    room.onMessage('intermission', (m) => {
      if (phase === 'playing') setStatus('下一回合 ' + m.seconds + ' 秒后开始…', true);
    });

    room.onMessage('turnDeadline', (m) => startDeadline(m.seconds));

    room.onMessage('ended', (m) => {
      stopDeadline();
      phase = 'ended';
      showModal(m.text || '对局结束');
    });

    room.onMessage('system', (m) => {
      const text = typeof m === 'string' ? m : (m && m.text) || '';
      if (text) appendLog(['[系统] ' + text]);
    });

    room.onLeave = () => {
      const intent = leavingByIntent;
      cleanup();
      if (!intent) {
        setConn('连接已断开', 'err');
        failTip('与服务器的连接中断了，请重新进入。');
      } else {
        setConn('未连接');
      }
      show('connect');
    };
  }

  function backToWaiting() {
    phase = 'lobby';
    mirror = null;
    viewPlayers = [];
    roundNo = 0;
    locked = false;
    submittedLabel = '';
    show('waiting');
  }

  function renderWaiting(info) {
    $('#room-id-text').textContent = room ? room.roomId : '----';
    const players = info.players || [];
    $('#seat-count').textContent = players.length + '/' + info.maxPlayers;
    const list = $('#seat-list');
    list.innerHTML = '';
    for (let i = 0; i < info.maxPlayers; i++) {
      const row = document.createElement('div');
      row.className = 'seat-row' + (players[i] ? '' : ' empty-seat');
      const no = document.createElement('span');
      no.className = 'seat-no';
      no.textContent = i + 1;
      row.appendChild(no);
      const nm = document.createElement('span');
      nm.className = 'seat-name';
      nm.textContent = players[i] ? players[i].name : '等待加入…';
      row.appendChild(nm);
      if (players[i]) {
        if (players[i].isHost) addTag(row, '房主', 'host');
        if (me.role === 'player' && me.seat === i) addTag(row, '你', 'me');
        if (players[i].connected === false) addTag(row, '离线', 'offline');
      }
      list.appendChild(row);
    }
    const specs = info.spectators || [];
    $('#spec-count').textContent = specs.length;
    const specBox = $('#spec-list');
    specBox.innerHTML = '';
    if (specs.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty-tip';
      p.textContent = '暂无观众';
      specBox.appendChild(p);
    } else {
      for (const s of specs) {
        const chip = document.createElement('span');
        chip.className = 'spec-chip';
        chip.textContent = s;
        specBox.appendChild(chip);
      }
    }

    const startBtn = $('#btn-start');
    startBtn.disabled = !(info.phase === 'lobby' && me.isHost && players.length >= 2);
    startBtn.classList.toggle('next-btn', !startBtn.disabled);
    $('#wait-tip').textContent = info.phase !== 'lobby'
      ? (info.phase === 'playing' ? '对局进行中…' : '对局已结束')
      : (me.isHost
        ? (players.length >= 2 ? '人齐了，可以开局！' : '还需至少 1 名玩家加入')
        : '等待房主开始…');
    $('#waiting-phase-tip').textContent =
      '房间号 ' + (room ? room.roomId : '') + ' · 上限 ' + info.maxPlayers + ' 人 · 观战 ' + specs.length + ' 人';
  }

  function addTag(row, text, cls) {
    const t = document.createElement('span');
    t.className = 'seat-tag ' + cls;
    t.textContent = text;
    row.appendChild(t);
  }

  function ensureMirrorAndArena(n) {
    if (!mirror || mirror.playerCount !== n) {
      mirror = new GameEngine(Math.max(2, n));
      buildArena(n);
    }
  }

  function startGameView(snap) {
    const players = snap.players || [];
    mirror = null;
    ensureMirrorAndArena(players.length);
    viewPlayers = players;
    syncMirror(players);
    roundNo = snap.round || 1;
    $('#round-info').textContent = '回合 ' + roundNo;
    const log = $('#log-box');
    log.innerHTML = '';
    log.hidden = true;
    locked = false;
    submittedLabel = '';
    closeAllPanels();
    renderAll();
    applySeatExpand();
    updateRoleBadge();
    show('game');
    setStatus(canAct() ? '请选择动作' : (me.role === 'spectator' ? '观战中' : '请选择动作'));
    appendLog(['—— 对战开始！共 ' + players.length + ' 名玩家 ——']);
  }

  function syncFromSnapshot(m) {
    const players = m.players || [];
    ensureMirrorAndArena(players.length);
    viewPlayers = players;
    syncMirror(players);
    roundNo = m.round || roundNo;
    $('#round-info').textContent = '回合 ' + roundNo;
    locked = false;
    submittedLabel = '';
    closeAllPanels();
    $('#report').hidden = true;
    $('#fx-layer').innerHTML = '';
    renderAll();
    applySeatExpand();
    updateRoleBadge();
    setStatus(canAct() ? '请选择动作' :
      (viewPlayers[me.seat] && viewPlayers[me.seat].hp <= 0 ? '你已出局，观战中' : '观战中'));
    appendLog(['—— 回合 ' + roundNo + ' ——']);
  }

  function applyReport(m) {
    viewPlayers = m.players || viewPlayers;
    syncMirror(viewPlayers);
    renderAll();
    const lines = String(m.log_message || '').split('\n').filter(l => l.trim());
    const repEl = $('#report');
    repEl.innerHTML = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = 'report-line' + reportLineClass(line);
      div.textContent = line;
      repEl.appendChild(div);
    }
    repEl.hidden = lines.length === 0;
    appendLog(lines);
    for (let i = 0; i < viewPlayers.length; i++) {
      const act = m.actions && m.actions['p' + (i + 1)];
      const label = $('#action-label-' + i);
      if (label) label.textContent = act ? '已选择：' + formatAction(act) : '—';
    }
    submittedLabel = '';
    if (m.winner) {
      setStatus(m.winner === '平局' ? '平局！' : m.winner + ' 获胜！');
    } else {
      setStatus('结算完毕，稍候进入下一回合…');
    }
  }

  function updateRoleBadge() {
    $('#role-badge').textContent = me.role === 'spectator' ? '观战' : '联机';
    const chip = $('#me-chip');
    if (me.role === 'spectator') {
      chip.textContent = '你：观众视角';
    } else {
      const p = viewPlayers[me.seat];
      chip.textContent = '你：' + (p && p.name ? p.name : '玩家') + ' · 座位 ' + (me.seat + 1);
    }
  }

  function canAct() {
    return me.role === 'player' && me.seat >= 0 && phase === 'playing' &&
      viewPlayers[me.seat] && viewPlayers[me.seat].hp > 0 && !locked;
  }

  function refreshControlAvailability() {
    const actable = canAct();
    $('#controls').hidden = !actable;
    ['gather-panel', 'use-panel', 'amount-panel', 'target-panel'].forEach(id => {
      if (!actable) $('#' + id).hidden = true;
    });
    if (actable) {
      const bound = isBound();
      const last = bound ? mirrorPlayer().status.lastAction : null;
      $('#btn-gather').disabled = bound && !(last && last.type === ACTION.GATHER);
      $('#btn-use').disabled = false;
      $('#btn-defend').disabled = false;
      if (bound) setStatus('你被藤蔓束缚：只能防御、复读上回合动作，或用金之斩挣脱');
    }
  }

  function buildArena(n) {
    const arena = $('#arena');
    arena.className = 'arena ' + (n === 2 ? 'duo' : 'multi') + (n > 2 ? ' focus-mode' : '');
    arena.innerHTML = '';
    expandedSeat = -1;
    const half = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      arena.insertAdjacentHTML('beforeend', seatPanelHTML(i));
      if (n === 2 && i === 0) arena.insertAdjacentHTML('beforeend', stageHTML());
    }
    if (n !== 2) arena.insertAdjacentHTML('beforeend', stageHTML());
    arena.insertAdjacentHTML('beforeend', '<div class="fx-layer" id="fx-layer"></div>');
    for (let i = 0; i < n; i++) {
      $('#seat-' + i).classList.add(i < half ? 'player-left' : 'player-right');
      // V4.1：多人聚焦模式下，点击对手卡片展开/收起详情
      if (n > 2) {
        const sec = $('#seat-' + i);
        sec.title = '点击展开 / 收起详情';
        sec.addEventListener('click', () => toggleSeatExpand(i));
      }
    }
  }

  function toggleSeatExpand(i) {
    expandedSeat = expandedSeat === i ? -1 : i;
    applySeatExpand();
  }

  function applySeatExpand() {
    for (let j = 0; j < viewPlayers.length; j++) {
      const sec = $('#seat-' + j);
      if (!sec) continue;
      sec.classList.toggle('expanded', j === expandedSeat);
    }
  }

  function stageHTML() {
    return (
      '<section class="stage">' +
      '<div class="vs-emblem" aria-hidden="true"><span>VS</span></div>' +
      '<div class="status-text" id="status-text">请选择动作</div>' +
      '<div class="report" id="report" hidden></div>' +
      '</section>'
    );
  }

  function seatPanelHTML(i) {
    const chips = GATHERABLE_ELEMENTS.map(el =>
      '<span class="el-chip el-' + el.toLowerCase() + '" data-el="' + el + '" title="' + ELEMENT_ICON[el] + '">' +
      '<span class="el-icon">' + ELEMENT_ICON[el] + '</span><span class="el-count">0</span></span>'
    ).join('');
    return (
      '<section class="player" id="seat-' + i + '">' +
      '<div class="player-header">' +
      '<div class="player-id"><span class="player-name">玩家' + (i + 1) + '</span><span class="player-tag"></span></div>' +
      '<span class="player-action" id="action-label-' + i + '">等待选择...</span>' +
      '</div>' +
      '<div class="character"><span class="aura"></span>' + (i % 2 === 0 ? '🤜' : '🤛') + '</div>' +
      '<div class="hud hp-bar"><span class="hud-label">HP</span><div class="hearts" id="hp-' + i + '"></div>' +
      '<span class="hp-num" id="hp-num-' + i + '">3/3</span></div>' +
      '<div class="hud elements-bar"><span class="hud-label el-label">元素</span><div class="el-chips" id="elements-' + i + '">' + chips + '</div></div>' +
      '<div class="hud weapons-row" id="weapons-' + i + '" hidden><span class="hud-label">武器</span><div class="weapon-chips">' +
      '<span class="weapon-chip" id="w-gatling-' + i + '">加特林</span>' +
      '<span class="weapon-chip" id="w-dual-' + i + '">双枪</span>' +
      '<span class="weapon-chip" id="w-ap-' + i + '">穿甲弹</span></div></div>' +
      '<div class="hud status-row" id="status-' + i + '" hidden><span class="hud-label">状态</span>' +
      '<div class="status-chips" id="status-chips-' + i + '"></div></div>' +
      '</section>'
    );
  }

  function syncMirror(players) {
    if (!mirror || mirror.playerCount !== players.length) {
      mirror = new GameEngine(Math.max(2, players.length));
    }
    mirror.players = JSON.parse(JSON.stringify(players));
  }

  function mirrorPlayer() {
    return mirror && mirror.players[me.seat];
  }

  function isBound() {
    const p = mirrorPlayer();
    return !!(p && p.status.bindTurns > 0);
  }

  function renderAll() {
    for (let i = 0; i < viewPlayers.length; i++) renderSeat(i);
    refreshControlAvailability();
    updateRoleBadge();
  }

  function renderSeat(i) {
    const p = viewPlayers[i];
    if (!p) return;
    const sec = $('#seat-' + i);
    if (!sec) return;

    sec.classList.toggle('seat-me', me.role === 'player' && me.seat === i);
    sec.querySelector('.player-name').textContent = p.name || ('玩家' + (i + 1));
    const tags = [];
    if (me.role === 'player' && me.seat === i) tags.push('你');
    if (hostSeats.has(i)) tags.push('房主');
    sec.querySelector('.player-tag').textContent = tags.join('·');

    const heartsBox = $('#hp-' + i);
    heartsBox.innerHTML = '';
    for (let k = 0; k < p.maxHp; k += 1) {
      const h = document.createElement('span');
      const remain = p.hp - k;
      h.className = 'heart' + (remain <= 0 ? ' empty' : (remain < 1 ? ' half' : ''));
      heartsBox.appendChild(h);
    }
    const numEl = $('#hp-num-' + i);
    numEl.textContent = fmtHp(p.hp) + '/' + fmtHp(p.maxHp);
    numEl.classList.toggle('low', p.hp <= 1);

    $$('#elements-' + i + ' .el-chip').forEach(chip => {
      const count = p.elements[chip.dataset.el];
      $('.el-count', chip).textContent = count;
      chip.classList.toggle('has', count > 0);
    });

    const w = p.weapons;
    $('#weapons-' + i).hidden = !(w.hasGatling || w.hasDualPistols || w.armorPiercing > 0);
    $('#w-gatling-' + i).classList.toggle('on', w.hasGatling);
    $('#w-dual-' + i).classList.toggle('on', w.hasDualPistols);
    const apChip = $('#w-ap-' + i);
    apChip.textContent = '穿甲弹 ×' + w.armorPiercing;
    apChip.classList.toggle('on', w.armorPiercing > 0);

    const st = p.status;
    const chips = $('#status-chips-' + i);
    chips.innerHTML = '';
    if (st.bindTurns > 0) chips.appendChild(statusChip('束缚', 'st-bind'));
    if (st.burnTurns > 0) chips.appendChild(statusChip('灼烧', 'st-burn'));
    if (st.seedTurns > 0) chips.appendChild(statusChip('寄生', 'st-seed'));
    if (st.wetTurns > 0) chips.appendChild(statusChip('水渍', 'st-wet'));
    if (st.scourImmuneTurns > 0) chips.appendChild(statusChip('免疫冲刷 ' + st.scourImmuneTurns, 'st-wet'));
    if (st.seedImmuneTurns > 0) chips.appendChild(statusChip('免疫种子 ' + st.seedImmuneTurns, 'st-seed'));
    if (st.bindImmuneTurns > 0) chips.appendChild(statusChip('免疫束缚 ' + st.bindImmuneTurns, 'st-bind'));
    if (st.shellLayers > 0) chips.appendChild(statusChip('岩壳 ×' + st.shellLayers, 'st-shell'));
    if (st.hasVein) chips.appendChild(statusChip('岩脉共鸣', 'st-vein'));
    $('#status-' + i).hidden = chips.childNodes.length === 0;

    const out = p.hp <= 0;
    sec.classList.toggle('seat-out', out);
    let badge = sec.querySelector('.out-badge');
    if (out && !badge) {
      badge = document.createElement('div');
      badge.className = 'out-badge';
      badge.textContent = '出局';
      sec.appendChild(badge);
    }
    if (!out && badge) badge.remove();

    if (me.role === 'player' && me.seat === i && submittedLabel) {
      $('#action-label-' + i).textContent = submittedLabel;
    }
  }

  function statusChip(text, cls) {
    const chip = document.createElement('span');
    chip.className = 'status-chip ' + cls;
    chip.textContent = text;
    return chip;
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

  function appendLog(lines, forcedCls) {
    const box = $('#log-box');
    if (!box) return;
    box.hidden = false;
    for (const line of lines) {
      if (!String(line).trim()) continue;
      const div = document.createElement('div');
      div.className = 'report-line' + (forcedCls ? ' ' + forcedCls : reportLineClass(line));
      div.textContent = line;
      box.appendChild(div);
    }
    while (box.childNodes.length > 200) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  function closeAllPanels() {
    ['gather-panel', 'use-panel', 'amount-panel', 'target-panel'].forEach(id => { $('#' + id).hidden = true; });
    targetCfg = null;
    targetSelected = [];
  }

  function aliveOpponents() {
    const out = [];
    for (let j = 0; j < viewPlayers.length; j++) {
      if (j !== me.seat && viewPlayers[j].hp > 0) out.push(j);
    }
    return out;
  }

  function openGatherPanel() {
    if (!canAct()) return;
    closeAllPanels();
    const bound = isBound();
    const last = bound ? mirrorPlayer().status.lastAction : null;
    const repeatGather = bound && last && last.type === ACTION.GATHER;
    $$('#gather-panel .el-btn').forEach(btn => {
      btn.disabled = bound && (!repeatGather || btn.dataset.el !== last.element);
    });
    if (bound && !repeatGather) return;
    $('#gather-panel').hidden = false;
  }

  function boundAllowedRoutes() {
    const allowed = new Set(['Jin.attack']);
    const last = mirrorPlayer().status.lastAction;
    if (last && last.type === ACTION.USE) allowed.add(last.element + '.' + last.route);
    return allowed;
  }

  function openUsePanel() {
    if (!canAct()) return;
    closeAllPanels();
    const list = $('#route-list');
    list.innerHTML = '';
    const bound = isBound();
    const allowed = bound ? boundAllowedRoutes() : null;
    let shown = 0;
    for (const el of ['Jin', 'Mu', 'Shui', 'Huo', 'Tu']) {
      const entries = [];
      for (const route of Object.keys(ROUTES[el])) {
        if (allowed && !allowed.has(el + '.' + route)) continue;
        const mp = mirrorPlayer();
        let feasible;
        if (route === 'gatlingFire') {
          feasible = mp.weapons.hasGatling && mp.elements.Jin >= 1;
        } else if (route === 'dualFire') {
          // V4.1：双枪在多人局按武器+资源判断即可，由 pickRoute 流程补目标
          feasible = mp.weapons.hasDualPistols && mp.elements.Jin >= 1;
        } else {
          feasible = mirror.isActionFeasible(me.seat, { type: ACTION.USE, element: el, route });
        }
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
        btn.innerHTML =
          '<span class="route-name">' + esc(ROUTES[el][route].name) + '</span>' +
          '<span class="route-cost">' + esc(ROUTE_COST[el + '.' + route] || '') + '</span>';
        btn.addEventListener('click', () => {
          if (!canAct()) return;
          pickRoute(el, route);
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
    $('#use-panel').hidden = false;
  }

  function pickRoute(el, route) {
    const bound = isBound();
    const last = bound ? mirrorPlayer().status.lastAction : null;
    const opps = aliveOpponents();
    if (opps.length === 0) { setStatus('没有存活的目标'); return; }
    if (route === 'gatlingFire') {
      if (bound && last && last.element === el && last.route === 'gatlingFire' && last.amount >= 1) {
        commit({ type: ACTION.USE, element: el, route, amount: last.amount, targets: last.targets });
      } else {
        openAmountPanel(el);
      }
      return;
    }
    if (NO_TARGET_ROUTES.has(el + '.' + route)) {
      commit({ type: ACTION.USE, element: el, route });
      return;
    }
    if (route === 'dualFire') {
      if (opps.length === 1) commit({ type: ACTION.USE, element: el, route, targets: [opps[0], opps[0]] });
      else openTargetPanel({ mode: 'dual', element: el, route, label: '双枪射击 · 选 2 个目标' });
      return;
    }
    if (route === 'fireRain') {
      if (opps.length === 1) commit({ type: ACTION.USE, element: el, route, targets: [opps[0]] });
      else openTargetPanel({ mode: 'rain', element: el, route, label: '火球雨 · 选择目标' });
      return;
    }
    if (opps.length === 1) commit({ type: ACTION.USE, element: el, route, targets: [opps[0]] });
    else openTargetPanel({ mode: 'single', element: el, route, label: ROUTES[el][route].name + ' · 选择目标' });
  }

  function openAmountPanel(el) {
    closeAllPanels();
    const list = $('#amount-list');
    list.innerHTML = '';
    const max = Math.min(mirrorPlayer().elements.Jin, 3);
    if (max < 1) { setStatus('金不足，无法射击'); return; }
    for (let n = 1; n <= max; n++) {
      const btn = document.createElement('button');
      btn.className = 'route-btn el-jin';
      btn.innerHTML =
        '<span class="route-name">射击 ' + 2 * n + ' 发</span>' +
        '<span class="route-cost">耗 ' + n + ' 金</span>';
      btn.addEventListener('click', () => {
        if (!canAct()) return;
        const opps = aliveOpponents();
        if (opps.length === 0) { setStatus('没有存活的目标'); return; }
        if (opps.length === 1) {
          commit({ type: ACTION.USE, element: el, route: 'gatlingFire', amount: n, targets: [opps[0]] });
        } else {
          openTargetPanel({
            mode: 'single',
            element: el,
            route: 'gatlingFire',
            amount: n,
            label: '加特林 ×' + n + '（' + 2 * n + ' 发）· 选择目标'
          });
        }
      });
      list.appendChild(btn);
    }
    $('#amount-panel').hidden = false;
  }

  function openTargetPanel(cfg) {
    closeAllPanels();
    targetCfg = cfg;
    targetSelected = [];
    $('#target-label').textContent = cfg.label || '选择目标';
    const list = $('#target-list');
    list.innerHTML = '';
    for (const j of aliveOpponents()) {
      const p = viewPlayers[j];
      const btn = document.createElement('button');
      btn.className = 'route-btn target-btn el-huo';
      btn.dataset.seat = String(j);
      btn.innerHTML =
        '<span class="route-name">' + esc(p.name || ('玩家' + (j + 1))) + '</span>' +
        '<span class="target-hp">❤ ' + fmtHp(p.hp) + '/' + fmtHp(p.maxHp) + '</span>';
      btn.addEventListener('click', () => {
        if (!canAct()) return;
        if (cfg.mode === 'single') {
          commit(buildTargetedAction([j]));
          return;
        }
        const idx = targetSelected.indexOf(j);
        if (idx >= 0) targetSelected.splice(idx, 1);
        else targetSelected.push(j);
        if (cfg.mode === 'dual' && targetSelected.length > 2) targetSelected.shift();
        $$('#target-list .target-btn').forEach(b => {
          b.classList.toggle('selected', targetSelected.includes(Number(b.dataset.seat)));
        });
        refreshTargetConfirm();
      });
      list.appendChild(btn);
    }
    refreshTargetConfirm();
    $('#target-confirm').onclick = () => {
      if (!canAct() || !targetCfg || targetCfg.mode === 'single') return;
      if (targetCfg.mode === 'dual' && targetSelected.length === 2) commit(buildTargetedAction(targetSelected.slice()));
      else if (targetCfg.mode === 'rain' && targetSelected.length >= 1) commit(buildTargetedAction(targetSelected.slice()));
    };
    $('#target-panel').hidden = false;
  }

  function refreshTargetConfirm() {
    const btn = $('#target-confirm');
    if (!targetCfg || targetCfg.mode === 'single') {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    const cap = targetCfg.mode === 'rain'
      ? Math.max(1, Math.min(mirrorPlayer().elements.Huo, aliveOpponents().length))
      : 2;
    const min = targetCfg.mode === 'rain' ? 1 : 2;
    btn.disabled = !(targetSelected.length >= min && targetSelected.length <= cap);
    $('#target-label').textContent =
      (targetCfg.label || '选择目标') + '　已选 ' + targetSelected.length +
      '/' + (targetCfg.mode === 'rain' ? ('≤' + cap) : 2);
  }

  function buildTargetedAction(targets) {
    const act = { type: ACTION.USE, element: targetCfg.element, route: targetCfg.route };
    if (targetCfg.amount) act.amount = targetCfg.amount;
    act.targets = targets;
    return act;
  }

  function commit(actionObj) {
    if (!canAct() || !room) return;
    const act = normalize(actionObj);
    if (!mirror || !mirror.isActionFeasible(me.seat, act)) {
      setStatus('这一手当前不可行（资源不足或目标非法）');
      return;
    }
    room.send('submit', { action: act });
    locked = true;
    submittedLabel = '已选择：' + formatAction(act);
    closeAllPanels();
    $('#controls').hidden = true;
    setStatus('已提交，等待其他玩家出招…', true);
    $('#action-label-' + me.seat).textContent = submittedLabel;
  }

  function normalize(a) {
    const norm = {
      type: a.type,
      element: a.element || null,
      route: a.route || null,
      amount: Math.max(0, Number(a.amount) || 0),
      targets: Array.isArray(a.targets) ? a.targets.slice() : null
    };
    return norm;
  }

  // ---------- 特效（移植自单机版 main.js，按座位泛化） ----------
  function getAnchor(i) {
    const charEl = $('#seat-' + i + ' .character');
    if (!charEl) return { cx: 0, cy: 0 };
    const rect = charEl.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  }

  function spawnProjectileFx(fromSeat, toSeat, element, opts) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const from = getAnchor(fromSeat);
    const to = getAnchor(toSeat);
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

  function spawnBullets(fromSeat, targets, count, element, size, stagger) {
    for (let k = 0; k < count; k++) {
      spawnProjectileFx(fromSeat, targets[k % targets.length], element, {
        cls: 'fx-bullet',
        size,
        delay: k * stagger,
        dx: Math.random() * 20 - 10,
        dy: Math.random() * 30 - 15
      });
    }
  }

  function spawnAPRound(fromSeat, toSeat) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const from = getAnchor(fromSeat);
    const to = getAnchor(toSeat);
    const el = document.createElement('div');
    el.className = 'projectile fx-ap';
    el.style.setProperty('--x1', from.cx - rect.left + 'px');
    el.style.setProperty('--y1', from.cy - rect.top + 'px');
    el.style.setProperty('--x2', to.cx - rect.left + 'px');
    el.style.setProperty('--y2', to.cy - rect.top + 'px');
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function spawnAt(cls, seatIdx, opts) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const a = getAnchor(seatIdx);
    const el = document.createElement('div');
    el.className = cls;
    el.style.left = a.cx - rect.left + 'px';
    el.style.top = a.cy - rect.top + 'px';
    if (opts && opts.delay) el.style.animationDelay = opts.delay + 'ms';
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function spawnCraft(seatIdx) {
    const layer = $('#fx-layer');
    if (!layer) return;
    const rect = layer.getBoundingClientRect();
    const a = getAnchor(seatIdx);
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

  function punchCharacter(seatIdx) {
    const el = $('#seat-' + seatIdx + ' .character');
    if (!el) return;
    el.classList.remove('punching');
    void el.offsetWidth;
    el.classList.add('punching');
    el.addEventListener('animationend', () => el.classList.remove('punching'), { once: true });
  }

  function hurtFlash(seatIdx) {
    const el = $('#seat-' + seatIdx + ' .character');
    if (!el) return;
    el.classList.remove('hurt');
    void el.offsetWidth;
    el.classList.add('hurt');
    el.addEventListener('animationend', () => el.classList.remove('hurt'), { once: true });
  }

  function spawnShieldFx(seatIdx) {
    const sec = $('#seat-' + seatIdx);
    if (!sec) return;
    const el = document.createElement('div');
    el.className = 'shield';
    sec.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function spawnGatherFloat(seatIdx, element) {
    const sec = $('#seat-' + seatIdx);
    if (!sec) return;
    const el = document.createElement('div');
    el.className = 'gather-float';
    el.textContent = ELEMENT_ICON[element] + ' +1';
    el.style.color = ELEMENT_GLOW[element] || '#fff';
    sec.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function visualTargets(srcSeat, act, n) {
    let ts = Array.isArray(act.targets)
      ? act.targets.filter(t => Number.isInteger(t) && t >= 0 && t < n && t !== srcSeat)
      : [];
    if (ts.length === 0) ts = [(srcSeat + 1) % n];
    return ts;
  }

  function animatePlayerAction(seatIdx, act, n) {
    if (!act || !act.type) return;
    const ts = visualTargets(seatIdx, act, n);
    if (act.type === ACTION.GATHER) {
      spawnGatherFloat(seatIdx, act.element);
      return;
    }
    if (act.type === ACTION.DEFEND) {
      spawnShieldFx(seatIdx);
      return;
    }
    if (act.type !== ACTION.USE) return;
    switch (act.route) {
      case 'craftGatling':
      case 'craftDual':
      case 'craftAP':
        spawnCraft(seatIdx);
        break;
      case 'attack':
      case 'fireball':
        spawnProjectileFx(seatIdx, ts[0], act.element, { cls: 'fx-blade' });
        punchCharacter(seatIdx);
        break;
      case 'gatlingFire':
        spawnBullets(seatIdx, ts, 2 * (act.amount || 1), act.element, 13, 55);
        punchCharacter(seatIdx);
        break;
      case 'dualFire':
        ts.slice(0, 2).forEach((t, k) => spawnProjectileFx(seatIdx, t, act.element, { cls: 'fx-bullet', size: 18, delay: k * 120 }));
        punchCharacter(seatIdx);
        break;
      case 'apFire':
        spawnAPRound(seatIdx, ts[0]);
        punchCharacter(seatIdx);
        break;
      case 'fireRain':
        ts.forEach((t, k) => {
          for (let b = 0; b < 3; b++) {
            spawnProjectileFx(seatIdx, t, act.element, { cls: 'fx-bullet', size: 15, delay: (k * 3 + b) * 60 });
          }
        });
        punchCharacter(seatIdx);
        break;
      case 'blaze':
        spawnAt('fx-burst', ts[0]);
        punchCharacter(seatIdx);
        break;
      case 'burn':
        spawnProjectileFx(seatIdx, ts[0], act.element, { cls: 'fx-fireball' });
        spawnAt('fx-flame', ts[0]);
        punchCharacter(seatIdx);
        break;
      case 'bind':
        spawnAt('fx-vines', ts[0]);
        break;
      case 'seed':
        spawnProjectileFx(seatIdx, ts[0], act.element, { cls: 'fx-seed' });
        spawnAt('fx-grow', ts[0]);
        break;
      case 'thorn':
        spawnAt('fx-wall', seatIdx);
        break;
      case 'seep':
        spawnProjectileFx(seatIdx, ts[0], act.element, { cls: 'fx-droplet' });
        spawnAt('fx-wet', ts[0]);
        break;
      case 'scour':
        spawnAt('fx-scour', ts[0]);
        punchCharacter(seatIdx);
        break;
      case 'spring':
        spawnAt('fx-spring', seatIdx);
        break;
      case 'shell':
        spawnAt('fx-shell', seatIdx);
        break;
      case 'thornRock':
        spawnAt('fx-thornrock', seatIdx);
        break;
      case 'vein':
        spawnAt('fx-vein', seatIdx);
        break;
      default:
        spawnProjectileFx(seatIdx, ts[0], act.element, {});
        punchCharacter(seatIdx);
    }
  }

  function playRoundFx(report) {
    const n = viewPlayers.length || (report.players && report.players.length) || 0;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const act = report.actions && report.actions['p' + (i + 1)];
      animatePlayerAction(i, act, n);
    }
    for (let i = 0; i < n; i++) {
      const delta = report.hpChanges ? report.hpChanges[i] : 0;
      if (delta < 0) setTimeout(() => hurtFlash(i), 480);
    }
  }

  // ---------- 回合倒计时 ----------
  function startDeadline(seconds) {
    stopDeadline();
    let left = seconds;
    const chip = $('#deadline-chip');
    chip.hidden = false;
    chip.textContent = '⏳ 出招 ' + left + 's';
    deadlineTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        stopDeadline();
        return;
      }
      chip.textContent = '⏳ 出招 ' + left + 's';
      chip.classList.toggle('urgent', left <= 10);
    }, 1000);
  }

  function stopDeadline() {
    if (deadlineTimer) clearInterval(deadlineTimer);
    deadlineTimer = null;
    const chip = $('#deadline-chip');
    chip.hidden = true;
    chip.classList.remove('urgent');
  }

  // ---------- 结算弹窗 ----------
  function showModal(text) {
    $('#modal-title').textContent = text;
    $('#btn-again').hidden = !(me.role === 'player' && me.isHost);
    $('#modal-overlay').hidden = false;
  }

  function closeModal() {
    const modal = $('#modal-overlay');
    if (modal) modal.hidden = true;
  }

  // ---------- 房间列表 ----------
  async function refreshRooms() {
    const btn = $('#btn-refresh');
    btn.disabled = true;
    try {
      ensureClient();
      const rooms = await client.getAvailableRooms('clash');
      const box = $('#room-list');
      box.innerHTML = '';
      if (rooms.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-tip';
        p.textContent = '暂无公开房间，创建一个吧！';
        box.appendChild(p);
        return;
      }
      for (const item of rooms) {
        const meta = item.metadata || {};
        const row = document.createElement('div');
        row.className = 'room-item';
        const infoDiv = document.createElement('div');
        infoDiv.className = 'room-info';
        const nameDiv = document.createElement('div');
        nameDiv.className = 'room-name';
        nameDiv.textContent = (meta.hostName ? meta.hostName + ' 的房间' : '房间 ' + item.roomId.slice(0, 8));
        const metaDiv = document.createElement('div');
        metaDiv.className = 'room-meta';
        const playing = meta.phase === 'playing';
        metaDiv.innerHTML =
          '<span class="' + (playing ? 'playing' : '') + '">' + esc(meta.status || '') + '</span>' +
          ' · ' + (meta.spectators ? '👁' + meta.spectators + ' ' : '') +
          '<small>' + esc(item.roomId.slice(0, 8)) + '</small>';
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(metaDiv);
        row.appendChild(infoDiv);
        const joinBtn = document.createElement('button');
        const full = Number(meta.players) >= Number(meta.maxPlayers);
        if (playing) {
          joinBtn.textContent = '观战';
          joinBtn.className = 'join-room-btn spectate';
          joinBtn.addEventListener('click', () => joinListed(item.roomId, true));
        } else if (full) {
          joinBtn.textContent = '满员';
          joinBtn.className = 'join-room-btn spectate';
          joinBtn.disabled = true;
        } else {
          joinBtn.textContent = '加入';
          joinBtn.className = 'join-room-btn';
          joinBtn.addEventListener('click', () => joinListed(item.roomId, false));
        }
        row.appendChild(joinBtn);
        box.appendChild(row);
      }
    } catch (err) {
      failTip('获取房间列表失败：' + (err && err.message));
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- 事件绑定与启动 ----------
  function init() {
    const selMax = $('#select-max');
    for (let n = 2; n <= 9; n++) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = n + ' 人混战' + (n === 2 ? '（经典 1v1）' : '');
      selMax.appendChild(opt);
    }

    try {
      const saved = JSON.parse(sessionStorage.getItem(REJOIN_KEY));
      if (saved && saved.token) $('#btn-rejoin').hidden = false;
    } catch (e) { /* noop */ }

    $('#btn-create').addEventListener('click', createRoom);
    $('#btn-join-code').addEventListener('click', () => joinByCode());
    $('#btn-rejoin').addEventListener('click', rejoinLast);
    $('#btn-refresh').addEventListener('click', refreshRooms);

    $('#btn-copy-room').addEventListener('click', () => {
      if (!room) return;
      const done = () => { $('#btn-copy-room').classList.add('copied'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(room.roomId).then(done, done);
      } else {
        window.prompt('复制房间号：', room.roomId);
      }
    });

    $('#btn-start').addEventListener('click', () => { if (room) room.send('start'); });
    $('#btn-leave-room').addEventListener('click', leaveRoom);
    $('#btn-exit').addEventListener('click', leaveRoom);
    $('#btn-again').addEventListener('click', () => { if (room) room.send('rematch'); });

    $('#btn-gather').addEventListener('click', openGatherPanel);
    $('#btn-use').addEventListener('click', openUsePanel);
    $('#gather-cancel').addEventListener('click', closeAllPanels);
    $('#use-cancel').addEventListener('click', closeAllPanels);
    $('#amount-cancel').addEventListener('click', closeAllPanels);
    $('#target-cancel').addEventListener('click', closeAllPanels);

    $$('#gather-panel .el-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!canAct()) return;
        closeAllPanels();
        commit({ type: ACTION.GATHER, element: btn.dataset.el });
      });
    });
    $('#btn-defend').addEventListener('click', () => {
      if (!canAct()) return;
      closeAllPanels();
      commit({ type: ACTION.DEFEND });
    });
  }

  init();
})();

