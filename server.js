'use strict';

// V4.0 联机服务器入口（云部署版）
// - 端口动态绑定：process.env.PORT（本地默认 2567）
// - CORS 全放开（测试方便）：允许所有来源
// - Colyseus 挂载在自建 HTTP 服务器上，正确处理 ws 升级
// - 仅内存存储（Colyseus 内置 MemoryDriver），无 Redis/数据库依赖

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');
const { GameRoom } = require('./server/game-room');

// 云平台随机分配端口；本地开发回退 2567
const PORT = Number(process.env.PORT) || 2567;

const app = express();

// ---- CORS：全放开 ----
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// ---- 静态资源：游戏页面与引擎脚本 ----
app.use(express.static(path.join(__dirname)));
app.get('/vendor/colyseus.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'colyseus.js', 'dist', 'colyseus.js'));
});

// ---- Colyseus：挂在同一 HTTP 服务器上，共享端口（HTTP + ws 同源同端口）----
const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 6000,
    pingTimeout: 18000,
  }),
});
gameServer.define('clash', GameRoom);

process.on('SIGINT', () => gameServer.gracefullyShutdown(false).then(() => process.exit(0)));
process.on('SIGTERM', () => gameServer.gracefullyShutdown(false).then(() => process.exit(0)));

httpServer.listen(PORT, () => {
  console.log('[clap-clap] 联机服务器已启动: 端口 ' + PORT + ' （对战页 /online.html）');
});
