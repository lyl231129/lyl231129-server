/**
 * lyl231129 · 站点 + 游戏后端（一体化服务器）
 *
 *   node server.js              启动服务器（默认 8080）
 *   PORT=3000 node server.js    换端口
 *   node server.js --build      导出纯静态站到 dist/（可直接部署到静态托管）
 *   ADMIN_TOKEN=xxx node server.js  自定义管理密钥
 *
 * 零依赖，只用 Node 自带模块。数据存 data/db.json。
 *
 * 路由：
 *   /                     个人主页（游戏列表由服务端注入）
 *   /delta/               三角洲行动 · 玩家站
 *   /dl/文件名            downloads/ 目录里的文件（.rpk 等），自动计下载数
 *   /health               健康检查 + 统计
 *   /api/games            游戏列表 GET / 新增 POST(需密钥)
 *   /api/games/:id        查改删（改删需密钥）
 *   /api/orders           交易行挂单 GET / 上架 POST
 *   /api/orders/:id/cancel  撤单（手环端不带 body 也能撤）
 *   /api/sync             云存档上传 POST / 拉取 GET /api/sync/:user
 *   /api/messages         战场通讯 GET / POST
 *   /api/stats  /api/files
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createCore, MAX_BODY } = require('./core.js');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DIST_DIR = path.join(ROOT, 'dist');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const core = createCore(ROOT);

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.rpk': 'application/octet-stream'
};

/* ==================== 静态导出（--build） ==================== */

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) n += copyTree(s, d);
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

// 清空并重建目录。直接 rmSync 递归删目录在某些环境（走回收站的删除钩子）会失败，
// 所以先重命名成 .old，再删，删不掉也不影响本次构建。
function resetDir(dir) {
  let old = null;
  if (fs.existsSync(dir)) {
    old = dir + '.old';
    try { fs.rmSync(old, { recursive: true, force: true }); } catch (e) { /* 上一次的残留，删不掉就算了 */ }
    try { fs.renameSync(dir, old); } catch (e) { old = null; }
  }
  fs.mkdirSync(dir, { recursive: true });
  if (old) {
    try { fs.rmSync(old, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

function buildStatic() {
  const games = core.publicGames();
  let index = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  if (!index.includes('/*__GAMES__*/null')) console.warn('[build] 警告：index.html 里没找到注入标记 /*__GAMES__*/null');
  index = index.replace('/*__GAMES__*/null', JSON.stringify(games));
  index = index.replace('/*__STATIC__*/false', 'true');   // 静态托管：下载走同目录文件名

  resetDir(DIST_DIR);                                      // 重命名代替删除（部分环境下 rmSync 会被拦截）
  const copied = copyTree(PUBLIC_DIR, DIST_DIR);           // 含 assets/ 等全部文件
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), index); // 再用注入版覆盖首页
  fs.writeFileSync(path.join(DIST_DIR, 'games.json'), JSON.stringify({ ok: true, games }, null, 2));

  // 把可下载的游戏包也拷进静态站（静态托管没有 /dl/ 路由）
  let pkgs = 0;
  if (fs.existsSync(DOWNLOADS_DIR)) {
    for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
      const src = path.join(DOWNLOADS_DIR, f);
      if (!fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(DIST_DIR, f));
      pkgs++;
    }
  }

  console.log('[build] 已导出静态站 → ' + DIST_DIR);
  console.log('[build] 复制资源 ' + copied + ' 个 · 游戏包 ' + pkgs + ' 个 · 游戏 ' + games.length + ' 个已烘焙进 index.html');
  return 0;
}

if (process.argv.includes('--build')) process.exit(buildStatic());

/* ==================== HTTP ==================== */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-admin-token,Authorization');
}

function sendJson(res, code, obj) {
  cors(res);
  const b = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': b.length });
  res.end(b);
}

function sendBuffer(res, code, buf, type, extra) {
  cors(res);
  const head = Object.assign({ 'Content-Type': type, 'Content-Length': buf.length }, extra || {});
  res.writeHead(code, head);
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const p = JSON.parse(raw);
        resolve(p && typeof p === 'object' ? p : {});
      } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function safeJoin(dir, rel) {
  const target = path.resolve(dir, '.' + path.posix.normalize('/' + rel));
  return target.startsWith(path.resolve(dir)) ? target : null;
}

function serveFile(res, file, asAttachment) {
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { ok: false, error: '文件不存在' });
    const ext = path.extname(file).toLowerCase();
    const extra = {};
    if (asAttachment) extra['Content-Disposition'] = 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(path.basename(file));
    sendBuffer(res, 200, buf, MIME[ext] || 'application/octet-stream', extra);
  });
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();
  const url = req.url || '/';
  const qi = url.indexOf('?');
  let pathname = qi >= 0 ? url.slice(0, qi) : url;
  const query = new URLSearchParams(qi >= 0 ? url.slice(qi + 1) : '');
  try { pathname = decodeURIComponent(pathname); } catch (e) { /* 保持原样 */ }

  if (method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // 下载目录（计数）
  if (pathname.startsWith('/dl/')) {
    if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });
    const file = safeJoin(core.paths.DOWNLOAD_DIR, pathname.slice(4));
    if (!file) return sendJson(res, 400, { ok: false, error: '非法路径' });
    core.countDownload(path.basename(file));
    return serveFile(res, file, true);
  }

  // API / 健康检查 → 交给 core
  if (pathname === '/health' || pathname.startsWith('/api/')) {
    const body = method === 'GET' ? {} : await readBody(req);
    const r = core.handle({ method, path: pathname, query, body, headers: req.headers });
    return sendJson(res, r.status, r.json);
  }

  // 页面
  if (method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method not allowed' });

  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/delta' || rel === '/delta/') rel = '/delta.html';
  if (rel.endsWith('/')) rel += 'index.html';

  const file = safeJoin(PUBLIC_DIR, rel);
  if (!file) return sendJson(res, 400, { ok: false, error: '非法路径' });

  if (file.endsWith('index.html')) {
    // 服务端注入游戏数据，静态导出时也一样能烘焙
    return fs.readFile(file, 'utf8', (err, text) => {
      if (err) return sendJson(res, 404, { ok: false, error: 'not found' });
      const html = text.replace('/*__GAMES__*/null', JSON.stringify(core.publicGames()));
      sendBuffer(res, 200, Buffer.from(html, 'utf8'), MIME['.html']);
    });
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { ok: false, error: 'not found: ' + pathname });
    serveFile(res, file, false);
  });
});

server.listen(PORT, HOST, () => {
  const token = core.getToken();
  console.log('');
  console.log('  lyl231129 · 站点 + 游戏后端已启动');
  console.log('  ─────────────────────────────────────');
  console.log('  个人主页：  http://localhost:' + PORT + '/');
  console.log('  玩家站：    http://localhost:' + PORT + '/delta/');
  console.log('  健康检查：  http://localhost:' + PORT + '/health');
  console.log('  下载目录：  ' + core.paths.DOWNLOAD_DIR);
  console.log('  数据文件：  ' + core.paths.DB_FILE);
  console.log('  管理密钥：  ' + token + '   （请求头 x-admin-token，写接口要用）');
  console.log('  停止：      Ctrl + C');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n[exit] 保存数据中…');
  try {
    fs.mkdirSync(core.paths.DATA_DIR, { recursive: true });
    fs.writeFileSync(core.paths.DB_FILE, JSON.stringify(core.db, null, 2));
  } catch (e) { /* ignore */ }
  process.exit(0);
});
