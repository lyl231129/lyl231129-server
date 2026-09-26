/**
 * 核心业务逻辑（与运行环境无关）
 *
 * 被两处复用：
 *   - server.js        Node 原生 http 服务器（本地 / 自有服务器）
 *   - cloudbase/index.js  腾讯云开发 CloudBase 云函数（公网 HTTPS）
 *
 * 对外只有一个入口：core.handle({ method, path, query, body, headers })
 * 返回 { status, json } 或 { status, text, type }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PRICE = 99999999;
const MAX_BODY = 4 * 1024 * 1024;

function createCore(root) {
  const DATA_DIR = path.join(root, 'data');
  const DB_FILE = path.join(DATA_DIR, 'db.json');
  const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
  const DOWNLOAD_DIR = path.join(root, 'downloads');

  const EMPTY = { games: [], orders: [], saves: {}, messages: [], downloads: {}, visits: 0 };
  let db = Object.assign({}, EMPTY);
  let adminToken = '';

  /* ---------------- 存储 ---------------- */

  function loadDb() {
    try {
      const p = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = {
        games: Array.isArray(p.games) ? p.games : [],
        orders: Array.isArray(p.orders) ? p.orders : [],
        saves: p.saves && typeof p.saves === 'object' ? p.saves : {},
        messages: Array.isArray(p.messages) ? p.messages : [],
        downloads: p.downloads && typeof p.downloads === 'object' ? p.downloads : {},
        visits: Number(p.visits) || 0
      };
    } catch (e) {
      db = Object.assign({}, EMPTY);
    }
  }

  function loadAdmin() {
    if (process.env.ADMIN_TOKEN) {
      adminToken = process.env.ADMIN_TOKEN;
      return;
    }
    try {
      adminToken = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')).token;
    } catch (e) {
      adminToken = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(ADMIN_FILE, JSON.stringify({ token: adminToken, note: '管理密钥，勿外传' }, null, 2));
      } catch (e2) { /* 只读环境（云函数）忽略 */ }
    }
  }

  let saveTimer = null;
  function saveDb() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, DB_FILE);
      } catch (e) { /* 云函数只读环境下忽略 */ }
    }, 200);
  }

  /* ---------------- 工具 ---------------- */

  let seq = 0;
  const newId = () => Date.now().toString(36) + '-' + (seq++).toString(36) + '-' + crypto.randomBytes(2).toString('hex');

  function str(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max || 64) : '';
  }

  function isAdmin(headers, query) {
    const h = headers || {};
    const given = h['x-admin-token'] || h['authorization'] || query.get('token') || '';
    const clean = String(given).replace(/^Bearer\s+/i, '').trim();
    return !!adminToken && clean === adminToken;
  }

  const now = () => Date.now();

  /* ---------------- 游戏作品 ---------------- */

  function publicGames() {
    return db.games.filter((g) => g.status !== 'hidden').sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  function normalizeGame(body, base) {
    const g = base || {};
    const name = str(body.name, 40);
    if (!name) return { err: '缺少游戏名 name' };
    const tagsRaw = Array.isArray(body.tags) ? body.tags : String(body.tags || '').split(/[,，\s]+/);
    return {
      game: {
        id: g.id || newId(),
        name,
        en: str(body.en, 40),
        desc: str(body.desc, 200),
        version: str(body.version, 20),
        pkg: str(body.pkg, 60),
        device: str(body.device, 40) || '小米手环 9 Pro',
        tags: tagsRaw.map((t) => str(t, 12)).filter(Boolean).slice(0, 8),
        cover: str(body.cover, 200),          // 截图地址（可留空）
        file: str(body.file, 120),            // downloads 目录里的文件名，留空=不提供下载
        link: str(body.link, 300),            // 外链（网盘 / 帖子），留空=无
        status: str(body.status, 10) === 'hidden' ? 'hidden' : 'published',
        downloads: g.downloads || 0,
        created: g.created || now(),
        updated: now()
      }
    };
  }

  function createGame(body) {
    const r = normalizeGame(body, null);
    if (r.err) return { status: 400, json: { ok: false, error: r.err } };
    db.games.push(r.game);
    saveDb();
    return { status: 200, json: { ok: true, game: r.game } };
  }

  function updateGame(id, body) {
    const i = db.games.findIndex((g) => g.id === id);
    if (i < 0) return { status: 404, json: { ok: false, error: '游戏不存在' } };
    const r = normalizeGame(Object.assign({}, db.games[i], body), db.games[i]);
    if (r.err) return { status: 400, json: { ok: false, error: r.err } };
    if (body.downloads !== undefined) r.game.downloads = Math.max(0, Number(body.downloads) || 0);
    db.games[i] = r.game;
    saveDb();
    return { status: 200, json: { ok: true, game: r.game } };
  }

  function deleteGame(id) {
    const i = db.games.findIndex((g) => g.id === id);
    if (i < 0) return { status: 404, json: { ok: false, error: '游戏不存在' } };
    db.games.splice(i, 1);
    saveDb();
    return { status: 200, json: { ok: true } };
  }

  function countDownload(file) {
    if (!file) return;
    db.downloads[file] = (db.downloads[file] || 0) + 1;
    const g = db.games.find((x) => x.file === file);
    if (g) g.downloads = (g.downloads || 0) + 1;
    saveDb();
  }

  /* ---------------- 交易行 / 存档 / 通讯 ---------------- */

  const activeOrders = () => db.orders.filter((o) => o.status === 'active');

  function listOrders(query) {
    let list = activeOrders();
    const item = query.get('item');
    if (item) list = list.filter((o) => o.item === item);
    const type = query.get('type');
    if (type) list = list.filter((o) => o.type === type);
    const user = query.get('user');
    if (user) list = list.filter((o) => o.user === user);
    return list.slice().sort((a, b) => b.ts - a.ts).slice(0, 200);
  }

  function createOrder(body) {
    const user = str(body.user, 24);
    const item = str(body.item, 40);
    const type = str(body.type, 8) === 'buy' ? 'buy' : 'sell';
    const price = Number(body.price);
    if (!user) return { status: 400, json: { ok: false, error: '缺少 user' } };
    if (!item) return { status: 400, json: { ok: false, error: '缺少 item' } };
    if (!Number.isFinite(price)) return { status: 400, json: { ok: false, error: 'price 不是数字' } };
    if (!Number.isInteger(price)) return { status: 400, json: { ok: false, error: 'price 必须是整数' } };
    if (price < 0) return { status: 400, json: { ok: false, error: '价格不能为负' } };
    if (price > MAX_PRICE) return { status: 400, json: { ok: false, error: '价格超出上限 ' + MAX_PRICE } };
    const order = { id: newId(), user, item, price, type, ts: now(), status: 'active' };
    db.orders.push(order);
    if (db.orders.length > 5000) db.orders = db.orders.slice(-3000);
    saveDb();
    return { status: 200, json: { ok: true, order } };
  }

  function cancelOrder(id, body) {
    const o = db.orders.find((x) => x.id === id);
    if (!o) return { status: 404, json: { ok: false, error: '挂单不存在' } };
    if (o.status !== 'active') return { status: 200, json: { ok: true, note: '已处理过' } };
    const user = str(body && body.user, 24);
    // 手环端撤单不带 user；带了就必须匹配，防止乱撤别人的单
    if (user && user !== o.user) return { status: 403, json: { ok: false, error: '不能撤别人的单' } };
    o.status = 'canceled';
    o.cancelTs = now();
    saveDb();
    return { status: 200, json: { ok: true, order: o } };
  }

  function pushSave(body) {
    const user = str(body.user, 24);
    if (!user) return { status: 400, json: { ok: false, error: '缺少 user' } };
    if (body.data === undefined) return { status: 400, json: { ok: false, error: '缺少 data' } };
    db.saves[user] = { data: body.data, ts: now() };
    saveDb();
    return { status: 200, json: { ok: true, ts: db.saves[user].ts } };
  }

  function pullSave(user) {
    const rec = db.saves[str(user, 24)];
    if (!rec) return { status: 200, json: { ok: false, error: '云端暂无存档' } };
    return { status: 200, json: { ok: true, data: rec.data, ts: rec.ts } };
  }

  function postMessage(body) {
    const user = str(body.user, 24) || '匿名';
    const text = str(body.text, 140);
    if (!text) return { status: 400, json: { ok: false, error: '消息为空' } };
    const msg = { id: newId(), user, text, ts: now() };
    db.messages.push(msg);
    if (db.messages.length > 300) db.messages = db.messages.slice(-200);
    saveDb();
    return { status: 200, json: { ok: true, message: msg } };
  }

  /* ---------------- 路由 ---------------- */

  const startedAt = now();

  function handle(req) {
    const method = (req.method || 'GET').toUpperCase();
    const p = req.path || '/';
    const query = req.query || { get: () => null };
    const body = req.body || {};
    const headers = req.headers || {};

    if (method === 'OPTIONS') return { status: 204, json: {} };

    // 健康检查 / 统计
    if (p === '/health') {
      return {
        status: 200,
        json: {
          ok: true,
          service: 'lyl231129-server',
          uptime: Math.round((now() - startedAt) / 1000),
          stats: {
            games: publicGames().length,
            ordersActive: activeOrders().length,
            ordersTotal: db.orders.length,
            saves: Object.keys(db.saves).length,
            messages: db.messages.length,
            downloads: db.downloads,
            visits: db.visits
          }
        }
      };
    }

    if (p === '/api/stats') {
      return {
        status: 200,
        json: {
          ok: true,
          games: publicGames().length,
          ordersActive: activeOrders().length,
          saves: Object.keys(db.saves).length,
          messages: db.messages.length,
          downloads: db.downloads,
          visits: db.visits,
          uptime: Math.round((now() - startedAt) / 1000)
        }
      };
    }

    // 访问计数（首页 / 玩家站各调一次）
    if (p === '/api/hit' && method === 'POST') {
      db.visits += 1;
      saveDb();
      return { status: 200, json: { ok: true, visits: db.visits } };
    }

    /* ---- 游戏作品 ---- */
    if (p === '/api/games') {
      if (method === 'GET') return { status: 200, json: { ok: true, games: publicGames() } };
      if (method === 'POST') {
        if (!isAdmin(headers, query)) return { status: 401, json: { ok: false, error: '需要管理密钥 x-admin-token' } };
        return createGame(body);
      }
      return { status: 405, json: { ok: false, error: 'method not allowed' } };
    }

    let m = p.match(/^\/api\/games\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (method === 'GET') {
        const g = db.games.find((x) => x.id === id);
        return g ? { status: 200, json: { ok: true, game: g } } : { status: 404, json: { ok: false, error: '游戏不存在' } };
      }
      if (method === 'PUT' || method === 'PATCH') {
        if (!isAdmin(headers, query)) return { status: 401, json: { ok: false, error: '需要管理密钥 x-admin-token' } };
        return updateGame(id, body);
      }
      if (method === 'DELETE') {
        if (!isAdmin(headers, query)) return { status: 401, json: { ok: false, error: '需要管理密钥 x-admin-token' } };
        return deleteGame(id);
      }
      return { status: 405, json: { ok: false, error: 'method not allowed' } };
    }

    /* ---- 交易行 ---- */
    if (p === '/api/orders') {
      if (method === 'GET') return { status: 200, json: { ok: true, orders: listOrders(query) } };
      if (method === 'POST') return createOrder(body);
      return { status: 405, json: { ok: false, error: 'method not allowed' } };
    }

    m = p.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (m) {
      if (method !== 'POST') return { status: 405, json: { ok: false, error: 'method not allowed' } };
      return cancelOrder(decodeURIComponent(m[1]), body);
    }

    /* ---- 云存档 ---- */
    if (p === '/api/sync') {
      if (method !== 'POST') return { status: 405, json: { ok: false, error: 'method not allowed' } };
      return pushSave(body);
    }

    m = p.match(/^\/api\/sync\/([^/]+)$/);
    if (m) {
      if (method !== 'GET') return { status: 405, json: { ok: false, error: 'method not allowed' } };
      return pullSave(decodeURIComponent(m[1]));
    }

    /* ---- 战场通讯 ---- */
    if (p === '/api/messages') {
      if (method === 'GET') return { status: 200, json: { ok: true, messages: db.messages.slice(-100) } };
      if (method === 'POST') return postMessage(body);
      return { status: 405, json: { ok: false, error: 'method not allowed' } };
    }

    /* ---- 下载 ---- */
    if (p === '/api/files') {
      let files = [];
      try {
        files = fs.readdirSync(DOWNLOAD_DIR).filter((f) => !f.startsWith('.'))
          .map((f) => ({ name: f, size: fs.statSync(path.join(DOWNLOAD_DIR, f)).size, downloads: db.downloads[f] || 0 }));
      } catch (e) { /* 目录不存在 */ }
      return { status: 200, json: { ok: true, files } };
    }

    return { status: 404, json: { ok: false, error: 'not found: ' + p } };
  }

  loadDb();
  loadAdmin();

  return {
    handle,
    db,
    getToken: () => adminToken,
    publicGames,
    countDownload,
    saveDb,
    paths: { DATA_DIR, DB_FILE, DOWNLOAD_DIR }
  };
}

module.exports = { createCore, MAX_BODY };
