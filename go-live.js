#!/usr/bin/env node
/**
 * go-live.js —— 一条命令把游戏服务器暴露到公网并自动重打包 rpk
 *
 * 用法：
 *   node go-live.js                自动：起服务 + 拉 cloudflared 隧道 + set-base + 打包
 *   node go-live.js --no-build     只起服务+拉隧道，不重打包（调试用）
 *   node go-live.js --url https://你的固定地址   跳过隧道，直接改源码+打包（你有稳定地址时用）
 *
 * 说明：
 *   - cloudflared 免费、无需账号，但每次启动给的域名是随机的（会重打包）。
 *     如果你想要固定地址，用 --url 喂一个（花生壳/CloudBase/Render 等稳定域名）。
 *   - 手环请求走手机转发，必须是公网 HTTPS，localhost/内网IP 不行。
 */

'use strict';

const { spawn, execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = __dirname;                                  // server/
const REPO = path.join(ROOT, '..');                      // deltaforce/
const PORT = process.env.PORT || 8080;
const BIN = path.join(ROOT, 'cloudflared.exe');
const CF_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const urlArg = (() => { const i = args.indexOf('--url'); return i >= 0 ? args[i + 1] : null; })();

const log = (...a) => console.log('[go-live]', ...a);
const ok = (...a) => console.log('  ✓', ...a);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 端口是否已在监听
function serverUp() {
  try {
    execSync(`netstat -ano | findstr :${PORT} | findstr LISTENING`, { stdio: 'pipe' });
    return true;
  } catch (e) { return false; }
}

// 拉起本地服务器（仅在没运行时）
let serverProc = null;
function ensureServer() {
  if (serverUp()) { ok(`本地服务器已在 :${PORT} 运行`); return; }
  log(`启动本地服务器 :${PORT} ...`);
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT }, stdio: 'ignore',
  });
  serverProc.on('error', e => console.error('  ✗ 服务器启动失败:', e.message));
}

// 下载 cloudflared（跟随重定向）
function downloadCloudflared() {
  return new Promise((resolve, reject) => {
    const tryGet = (url, depth) => {
      if (depth > 5) return reject(new Error('重定向次数过多'));
      https.get(url, res => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          return tryGet(res.headers.location, depth + 1);
        }
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const f = fs.createWriteStream(BIN);
        res.pipe(f);
        f.on('finish', () => { f.close(); resolve(); });
      }).on('error', reject);
    };
    tryGet(CF_URL, 0);
  });
}

async function ensureBin() {
  if (fs.existsSync(BIN) && fs.statSync(BIN).size > 1e6) { ok('cloudflared 已就绪'); return; }
  log('下载 cloudflared（首次约 30MB，需联网）...');
  await downloadCloudflared();
  ok('cloudflared 下载完成');
}

// 启动隧道，解析公网地址
function startTunnel() {
  return new Promise((resolve, reject) => {
    const p = spawn(BIN, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = chunk => {
      out += chunk.toString();
      const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { p.stdout.removeListener('data', onData); resolve({ proc: p, url: m[0] }); }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', d => process.stdout.write('  cloudflared: ' + d.toString()));
    p.on('error', e => reject(e));
    setTimeout(() => reject(new Error('15 秒内未拿到公网地址（检查网络/是否被墙）')), 15000);
  });
}

// 写地址进源码并打包
function wireAndBuild(url) {
  log(`写入公网地址 → ${url}`);
  execFileSync(process.execPath, ['set-base.js', url], { cwd: ROOT, stdio: 'inherit' });
  if (NO_BUILD) { log('跳过打包（--no-build）'); return; }
  log('重新打包 rpk（aiot build）...');
  execSync('npm run build', { cwd: REPO, stdio: 'inherit' });
  ok('打包完成，新 rpk 已生成');
}

async function main() {
  ensureServer();
  await sleep(800);

  if (urlArg) {
    log('使用指定地址，跳过隧道');
    wireAndBuild(urlArg);
    log('完成。把新 rpk 装到手环即可联网。');
    return;
  }

  await ensureBin();
  log('启动公网隧道（cloudflared quick tunnel）...');
  const { proc, url } = await startTunnel();
  ok('公网地址: ' + url);

  wireAndBuild(url);

  log('──────────────────────────────────────────');
  log('服务器已上线：' + url);
  log('① 手机流量打开 ' + url + '/health 确认通（手环走手机出去）');
  log('② 把新 rpk 装到手环：dist/com.lilin.deltaforce.debug.*.rpk');
  log('③ 注意：cloudflared 免费版地址每次启动都会变，下次开机重跑本脚本即可');
  log('   Ctrl+C 退出（会同时关闭隧道' + (serverProc ? '和本地服务器' : '') + '）');
  log('──────────────────────────────────────────');

  const cleanup = () => {
    try { proc.kill(); } catch (e) {}
    if (serverProc) try { serverProc.kill(); } catch (e) {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(e => { console.error('[go-live] 失败:', e.message); process.exit(1); });
