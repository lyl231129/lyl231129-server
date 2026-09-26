/**
 * 腾讯云开发 CloudBase 云函数版（HTTP 访问服务）
 *
 * 用法：
 *   1. 在 CloudBase 控制台新建云函数，函数名随意（如 deltaforce）
 *   2. 把本目录的 index.js 与 ../core.js 一起上传（函数目录里两个文件平级）
 *   3. 开启「HTTP 访问服务」，得到 https://xxx.service.tcloudbase.com/<函数名>
 *   4. 把那个地址填进 src/common/api.js 的 BASE
 *
 * ⚠️ 注意：云函数的本地磁盘不保证持久，实例回收后数据会丢。
 *    正式运营请把 core.js 里的 saveDb/loadDb 换成云数据库（CloudBase 自带）。
 *    接口路径与本地版完全一致，迁移只换地址，不改手环端代码。
 */

const path = require('path');
const { createCore } = require('./core.js');

const core = createCore(path.resolve(__dirname, '..'));

function parseQuery(q) {
  const map = q || {};
  return { get: (k) => (map[k] === undefined ? null : String(map[k])) };
}

function parseBody(event) {
  const raw = event.body;
  if (!raw) return {};
  let text = raw;
  if (event.isBase64Encoded) {
    try { text = Buffer.from(raw, 'base64').toString('utf8'); } catch (e) { return {}; }
  }
  try {
    const p = JSON.parse(text);
    return p && typeof p === 'object' ? p : {};
  } catch (e) {
    return {};
  }
}

exports.main = async function (event) {
  const ep = event.path || event.url || '/';
  const qi = ep.indexOf('?');
  const p = qi >= 0 ? ep.slice(0, qi) : ep;

  // 云函数的路径带函数名前缀，去掉它，保证 /api/xxx 对得上
  const fn = (process.env.SCF_FUNCTIONNAME || event.functionName || '').replace(/^\//, '');
  let pathname = p;
  if (fn && pathname.startsWith('/' + fn)) pathname = pathname.slice(fn.length + 1) || '/';

  const r = core.handle({
    method: event.httpMethod || event.method || 'GET',
    path: pathname,
    query: parseQuery(event.queryStringParameters || event.query),
    body: parseBody(event),
    headers: event.headers || {}
  });

  return {
    statusCode: r.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,x-admin-token,Authorization'
    },
    body: JSON.stringify(r.json || {})
  };
};
