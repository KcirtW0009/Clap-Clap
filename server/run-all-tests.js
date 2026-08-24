'use strict';

// 联机集成测试编排：依次以不同环境变量启动服务器，跑完全部冒烟场景后关闭
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 2567;

const CASES = [
  { name: 'smoke', env: { INTERMISSION_MS: '300' }, script: 'smoke-test.js' },
  { name: 'room(房间制/观战/加特林)', env: { INTERMISSION_MS: '300' }, script: 'room-test.js' },
  { name: 'timeout(操作超时判负)', env: { INTERMISSION_MS: '300', TURN_TIMEOUT_MS: '2000' }, script: 'timeout-test.js' },
  { name: 'reconnect(断线保座)', env: { INTERMISSION_MS: '300', TURN_TIMEOUT_MS: '2500' }, script: 'reconnect-test.js' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer(env) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', d => process.stdout.write('[srv] ' + d));
  proc.stderr.on('data', d => process.stderr.write('[srv!] ' + d));
  return proc;
}

function stopServer(proc) {
  return new Promise(resolve => {
    if (proc.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (e) { /* noop */ }
      resolve();
    }, 3000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    proc.kill();
  });
}

function waitForReady(proc) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = async () => {
      if (proc.exitCode !== null) return reject(new Error('server exited early, code=' + proc.exitCode));
      const ok = await new Promise(res => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 800 }, r => {
          res(r.statusCode === 200 || r.statusCode === 404);
          r.resume();
        });
        req.on('error', () => res(false));
        req.on('timeout', () => { req.destroy(); res(false); });
      });
      if (ok) return resolve();
      if (++tries > 50) return reject(new Error('server not ready in time'));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function runTest(script) {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    });
    proc.on('exit', code => resolve(code));
  });
}

(async () => {
  let failed = false;
  for (const c of CASES) {
    console.log('\n===== ' + c.name + ' =====');
    Object.assign(process.env, c.env);
    const srv = startServer(c.env);
    try {
      await waitForReady(srv);
      const code = await runTest(c.script);
      if (code !== 0) { failed = true; console.log('>>> ' + c.name + ' FAILED'); }
      else console.log('>>> ' + c.name + ' PASSED');
    } catch (err) {
      failed = true;
      console.log('>>> ' + c.name + ' ERROR: ' + err.message);
    } finally {
      await stopServer(srv);
    }
  }
  console.log(failed ? '\nSOME TESTS FAILED' : '\nALL SERVER TESTS PASSED');
  process.exit(failed ? 1 : 0);
})();
