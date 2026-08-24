'use strict';

// V4.0 联机前端：Colyseus 客户端 + 引擎常量做本地可行性预览
/* global Colyseus, ACTION, ROUTES, ELEMENT_LABEL, GATHERABLE_ELEMENTS, MAX_ELEMENT */

(function () {
  const $ = id => document.getElementById(id);
  const ENDPOINT = location.protocol.replace('http', 'ws') + '//' + location.host;

  let room = null;
  let mySeat = -1;
  let lastPlayers = null;
  let pendingAction = null; // 待提交动作
  let locked = false;       // 已提交/间歇中
  let countdownTimer = null;

  // ---------- 工具 ----------
  function show(screen) {
    for (const s of ['screen-connect', 'screen-lobby', 'screen-game']) {
      $(s).classList.toggle('hidden', s !== screen);
    }
  }
  function setConn(text, isErr) {
    const el = $('connState');
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
  }
  function hpText(hp, maxHp) {
    const v = Math.round(hp * 10) / 10;
    return v + ' / ' + maxHp;
  }
  function appendLog(lines, cls) {
    const box = $('logBox');
    for (const line of String(lines).split('\n')) {
      if (!line.trim()) continue;
      const div = document.createElement('div');
      div.textContent = line;
      if (cls) div.className = cls;
      box.appendChild(div);
    }
    box.scrollTop = box.scrollHeight;
  }

  // ---------- 视图渲染 ----------
  function renderFighter(seatViewIdx, p) {
    const n = seatViewIdx === 0 ? 0 : 1;
    $('name' + n).textContent = p.name || ('玩家' + (n + 1));
    $('hp' + n).style.width = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100)) + '%';
    $('hpnum' + n).textContent = hpText(p.hp, p.maxHp);

    const elems = $('elems' + n);
    elems.innerHTML = '';
    for (const el of GATHERABLE_ELEMENTS) {
      const d = document.createElement('div');
      d.className = 'elem' + (p.elements[el] > 0 ? ' on' : '');
      d.dataset.el = el;
      d.title = (ELEMENT_LABEL[el] || el) + ' ×' + p.elements[el];
      d.textContent = p.elements[el];
      elems.appendChild(d);
    }

    const st = p.status || {};
    const sts = [];
    if (st.bindTurns > 0) sts.push(['被束缚 ' + st.bindTurns, 'bad']);
    if (st.burnTurns > 0) sts.push(['灼烧', 'bad']);
    if (st.seedTurns > 0) sts.push(['寄生', 'bad']);
    if (st.wetTurns > 0) sts.push(['水渍', 'bad']);
    if (st.shellLayers > 0) sts.push(['岩壳 ×' + st.shellLayers, 'good']);
    if (st.hasVein) sts.push(['岩脉共鸣', 'good']);
    if (st.scourImmuneTurns > 0) sts.push(['免疫冲刷 ' + st.scourImmuneTurns, 'good']);
    if (st.seedImmuneTurns > 0) sts.push(['免疫种子 ' + st.seedImmuneTurns, 'good']);
    if (st.bindImmuneTurns > 0) sts.push(['免疫束缚 ' + st.bindImmuneTurns, 'good']);
    const box = $('sts' + n);
    box.innerHTML = '';
    for (const [text, kind] of sts) {
      const s = document.createElement('span');
      s.className = 'st ' + kind;
      s.textContent = text;
      box.appendChild(s);
    }
  }

  function renderAll(players) {
    if (!players) return;
    lastPlayers = players;
    renderFighter(0, players[mySeat]);
    renderFighter(1, players[1 - mySeat]);
    refreshRepeat();
  }

  function setLocked(v) {
    locked = v;
    $('commitBtn').classList.toggle('hidden', v);
    $('lockTip').classList.toggle('hidden', !v);
    for (const b of document.querySelectorAll('.actions button, .actions select')) b.disabled = v;
  }

  function clearSelection() {
    pendingAction = null;
    for (const b of document.querySelectorAll('.abtn')) b.classList.remove('sel');
    $('useCost').textContent = '';
  }

  // ---------- 动作面板 ----------
  function buildUseOptions() {
    const sel = $('useSelect');
    sel.innerHTML = '';
    const skip = new Set(['gatlingFire', 'dualFire']); // 需要多目标/数量的路线暂不开放
    for (const el of Object.keys(ROUTES)) {
      for (const route of Object.keys(ROUTES[el])) {
        if (skip.has(route)) continue;
        const r = ROUTES[el][route];
        const opt = document.createElement('option');
        let label = (ELEMENT_LABEL[el] || el) + '·' + r.name;
        let ok = true;
        if (typeof r.cost === 'number') label += '（耗' + r.cost + '）';
        else if (r.cost === 'all') label += '（全部）';
        else if (r.cost === 'ap') label += '（穿甲弹）';
        else if (r.cost === 'amount') { label += '（加特林）'; }
        opt.value = JSON.stringify({ type: 'use', element: el, route });
        opt.textContent = label;
        sel.appendChild(opt);
        void ok;
      }
    }
    describeUse();
  }

  function localFeasible(act) {
    // 轻量本地预检（完整判定以服务器为准）
    if (!lastPlayers || mySeat < 0) return false;
    const me = lastPlayers[mySeat];
    if (act.type === 'gather') return GATHERABLE_ELEMENTS.includes(act.element);
    if (act.type !== 'use') return true; // defend
    const r = ROUTES[act.element] && ROUTES[act.element][act.route];
    if (!r) return false;
    if (typeof r.cost === 'number') {
      if (act.route === 'craftGatling' && me.weapons.hasGatling) return false;
      if (act.route === 'craftDual' && me.weapons.hasDualPistols) return false;
      if (act.route === 'gatlingFire' && !me.weapons.hasGatling) return false;
      if (act.route === 'dualFire' && !me.weapons.hasDualPistols) return false;
      return me.elements[act.element] >= r.cost;
    }
    if (r.cost === 'all') return me.elements[act.element] >= 1;
    if (r.cost === 'ap') return me.weapons.armorPiercing >= 1;
    return true;
  }

  function describeUse() {
    try {
      const act = JSON.parse($('useSelect').value);
      const r = ROUTES[act.element][act.route];
      const me = lastPlayers ? lastPlayers[mySeat] : null;
      let have = '';
      if (me && typeof r.cost === 'number') have = ' · 现有 ' + me.elements[act.element];
      $('useCost').textContent = r.name + '：' + (r.desc || '') + have;
    } catch (e) { /* noop */ }
  }

  function refreshRepeat() {
    const me = lastPlayers ? lastPlayers[mySeat] : null;
    const la = me && me.status && me.status.lastAction;
    const canRepeat = la && la.type && la.type !== 'defend';
    $('repeatBtn').classList.toggle('hidden', !canRepeat);
  }

  function selectGather(btn, element) {
    clearSelection();
    btn.classList.add('sel');
    pendingAction = { type: 'gather', element };
  }

  function commit(action) {
    if (locked || !room) return;
    room.send('submit', { action });
    setLocked(true);
    clearSelection();
  }

  // ---------- 消息处理 ----------
  function bindRoomHandlers() {
    room.onMessage('welcome', (m) => {
      mySeat = m.seat;
      setConn('已连接 · 座位 ' + (m.seat + 1));
    });
    room.onMessage('lobby', (m) => {
      show('screen-lobby');
      $('lobbyPlayers').textContent = m.players.map(p => (p.seat + 1) + '. ' + p.name).join('　');
      $('lobbyText').textContent = m.players.length < 2 ? '等待对手加入…' : '对手已就位，即将开局…';
    });
    room.onMessage('started', (m) => {
      show('screen-game');
      $('logBox').innerHTML = '';
      appendLog('对局开始！回合 1', 'sysline');
      $('roundNo').textContent = m.round || 1;
      renderAll(m.players);
      setLocked(false);
      clearSelection();
    });
    room.onMessage('report', (m) => {
      stopCountdown();
      $('roundNo').textContent = m.round || $('roundNo').textContent;
      renderAll(m.players);
      appendLog(m.log_message);
    });
    room.onMessage('intermission', (m) => startCountdown(m.seconds));
    room.onMessage('sync', (m) => {
      stopCountdown();
      $('roundNo').textContent = m.round || $('roundNo').textContent;
      renderAll(m.players);
      setLocked(false);
      clearSelection();
      appendLog('—— 回合 ' + m.round + ' ——', 'sysline');
    });
    room.onMessage('ended', (m) => {
      stopCountdown();
      $('endText').textContent = m.text || '对局结束';
      $('overlay').classList.remove('hidden');
    });
    room.onMessage('system', (m) => {
      appendLog('[系统] ' + m.text, 'sysline');
    });
    room.onLeave = () => {
      // 断线/被移除：回连接页
      cleanupRoom();
      setConn('连接已断开', true);
      show('screen-connect');
    };
  }

  function startCountdown(sec) {
    stopCountdown();
    let left = sec;
    $('countdown').textContent = left + 's';
    countdownTimer = setInterval(() => {
      left -= 1;
      $('countdown').textContent = left > 0 ? left + 's' : '';
      if (left <= 0) stopCountdown();
    }, 1000);
  }
  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
    $('countdown').textContent = '';
  }

  function cleanupRoom() {
    stopCountdown();
    room = null;
    mySeat = -1;
    lastPlayers = null;
    pendingAction = null;
    locked = false;
    $('overlay').classList.add('hidden');
  }

  // ---------- 入口 ----------
  async function join() {
    const name = $('nameInput').value.trim() || '无名侠客';
    $('joinBtn').disabled = true;
    $('connectErr').textContent = '';
    setConn('连接中…');
    try {
      const client = new Colyseus.Client(ENDPOINT);
      room = await client.joinOrCreate('clash', { name });
      bindRoomHandlers();
      setConn('已连接');
      show('screen-lobby');
    } catch (err) {
      setConn('连接失败', true);
      $('connectErr').textContent = '无法连接服务器：' + (err && err.message);
    }
    $('joinBtn').disabled = false;
  }

  // ---------- 事件绑定 ----------
  $('joinBtn').addEventListener('click', join);
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  $('leaveBtn').addEventListener('click', () => { if (room) room.leave(); cleanupRoom(); show('screen-connect'); });

  for (const btn of document.querySelectorAll('.gbtn')) {
    btn.addEventListener('click', () => {
      if (locked) return;
      selectGather(btn, btn.dataset.gather);
    });
  }
  $('defBtn').addEventListener('click', () => {
    if (locked) return;
    clearSelection();
    $('defBtn').classList.add('sel');
    pendingAction = { type: 'defend' };
  });
  $('repeatBtn').addEventListener('click', () => {
    if (locked || !lastPlayers) return;
    const la = lastPlayers[mySeat].status.lastAction;
    if (!la) return;
    commit(JSON.parse(JSON.stringify(la)));
  });
  $('useSelect').addEventListener('change', describeUse);
  $('commitBtn').addEventListener('click', () => {
    if (locked) return;
    if (pendingAction) { commit(pendingAction); return; }
    try {
      const act = JSON.parse($('useSelect').value);
      if (localFeasible(act)) commit(act);
      else $('useCost').textContent = '资源不足，选不了这一手！';
    } catch (e) { /* noop */ }
  });
  $('againBtn').addEventListener('click', () => {
    if (room) room.leave();
    cleanupRoom();
    show('screen-connect');
  });

  buildUseOptions();
  show('screen-connect');
})();
