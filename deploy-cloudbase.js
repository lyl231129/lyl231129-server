#!/usr/bin/env node
/**
 * deploy-cloudbase.js —— 把游戏服务器部署到【腾讯云 CloudBase】（国内·中文·免费体验版）
 *
 * 和 deploy-cloud.js（fly.io 国外）是一对。这个走国内云，界面全中文，
 * 有「免费体验版」：0 元/月、每月 3000 资源点、有效期 6 个月（活动期内可 0 元续 6 个月），
 * 云函数调用 13.3 点/万次，一个小游戏服务器完全够用。
 *
 * 用法：
 *   node deploy-cloudbase.js                      全自动（需先准备好环境和登录）
 *   node deploy-cloudbase.js --env <环境ID>       指定已建好的环境，跳过自动选环境
 *   node deploy-cloudbase.js --no-build           只部署+拿地址+改源码，不重打包 rpk
 *   node deploy-cloudbase.js --apiKeyId <ID> --apiKey <KEY>   用密钥免交互登录（CI 用）
 *   node deploy-cloudbase.js --wire <URL>         已部署过，跳过部署只改源码+打包
 *   node deploy-cloudbase.js --help               看帮助
 *
 * ⚠️ 首次一次性准备（都在中文控制台点，不用看英文）：
 *   1. 注册腾讯云账号并完成【实名认证】（国内云都跑不掉，几分钟）。
 *   2. 开通云开发，创建一个【免费体验版】环境，拿到环境 ID（形如 xxxxx-envabc）。
 *      - 免费体验版入口：云开发控制台 → 新建环境 → 选「免费体验版」（0 元/月）。
 *   3. 本机装好 CloudBase CLI 并登录：
 *        npm install -g @cloudbase/cli
 *        tcb login          # 会弹中文浏览器让你扫码/授权
 *   然后跑本脚本，把环境 ID 用 --env 传进来（或让它自己选第一个环境）。
 *
 * 说明：
 *   - 手环请求走手机转发，必须是公网 HTTPS，localhost/内网 IP 不行。
 *   - 免费体验版磁盘不持久，环境回收后 data/db.json 会丢（交易行/存档演示够用）。
 *     正式运营把 core.js 里的 loadDb/saveDb 换成 CloudBase 自带的云数据库。
 *   - 免费环境有资源点上限，超了会被限流，长期运营建议升「个人版」（¥19.9/月）。
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;                                  // server/
const REPO = path.join(ROOT, '..');                      // deltaforce/
const FN = 'deltaforce';                                 // 云函数名
const CLOUDBASE_DIR = path.join(ROOT, 'cloudbase');      // 函数目录（index.js + core.js）

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const HELP = args.includes('--help') || args.includes('-h');
const envArg = (() => { const i = args.indexOf('--env'); return i >= 0 ? args[i + 1] : null; })();
const apiKeyId = (() => { const i = args.indexOf('--apiKeyId'); return i >= 0 ? args[i + 1] : null; })();
const apiKey = (() => { const i = args.indexOf('--apiKey'); return i >= 0 ? args[i + 1] : null; })();
const wireUrl = (() => { const i = args.indexOf('--wire'); return i >= 0 ? args[i + 1] : null; })();

const log = (...a) => console.log('[deploy-cloudbase]', ...a);
const ok = (...a) => console.log('  ✓', ...a);

function showHelp() {
  console.log(`
deploy-cloudbase.js —— 部署到腾讯云 CloudBase（国内·中文·免费体验版）

  node deploy-cloudbase.js                      全自动（需先建好免费环境并 tcb login）
  node deploy-cloudbase.js --env <环境ID>       指定环境，跳过自动选
  node deploy-cloudbase.js --no-build           部署但不重打包 rpk
  node deploy-cloudbase.js --apiKeyId <ID> --apiKey <KEY>   密钥免交互登录
  node deploy-cloudbase.js --wire <URL>         已部署过，跳过部署只改源码+打包
  node deploy-cloudbase.js --help               本帮助

首次请先看脚本顶部注释：实名认证 → 建免费体验版环境 → npm i -g @cloudbase/cli → tcb login。
`);
  process.exit(0);
}

// 找 tcb 命令（全局安装后在 PATH；找不到就用 npx 拉一次）
function findTcb() {
  try { execFileSync('tcb', ['--version'], { stdio: 'pipe' }); return 'tcb'; } catch (e) {}
  return null;
}

async function ensureTcb() {
  let bin = findTcb();
  if (bin) { ok('tcb 已就绪'); return bin; }
  log('未检测到 CloudBase CLI，自动安装（npm i -g @cloudbase/cli，需联网）...');
  execFileSync('npm', ['install', '-g', '@cloudbase/cli'], { stdio: 'inherit' });
  try { execFileSync('tcb', ['--version'], { stdio: 'pipe' }); return 'tcb'; }
  catch (e) { throw new Error('安装后仍未找到 tcb，请手动：npm install -g @cloudbase/cli'); }
}

// 登录（交互浏览器，或密钥免交互）
function auth(bin) {
  if (apiKeyId && apiKey) {
    process.env.TENCENTCLOUD_SECRET_ID = apiKeyId;
    process.env.TENCENTCLOUD_SECRET_KEY = apiKey;
    ok('已用密钥登录（非交互）');
    return;
  }
  log('打开浏览器登录腾讯云（中文页面，扫码/授权即可）...');
  try { execFileSync(bin, ['login'], { stdio: 'inherit' }); ok('登录成功'); }
  catch (e) { throw new Error('登录失败：' + e.message + '\n可改用 --apiKeyId/--apiKey 免交互登录'); }
}

// 选环境：--env 优先；否则取列表第一个；都没有就引导去控制台建免费环境
function resolveEnv(bin) {
  if (envArg) { execFileSync(bin, ['env', 'use', envArg], { stdio: 'inherit' }); return envArg; }
  let out = '';
  try { out = execFileSync(bin, ['env', 'list', '--json'], { stdio: 'pipe' }).toString(); } catch (e) {}
  let envId = null;
  try {
    const j = JSON.parse(out);
    const arr = Array.isArray(j) ? j : (j.data || j.envs || j.list || []);
    if (arr.length) envId = arr[0].envId || arr[0].EnvId || arr[0].id;
  } catch (e) {}
  if (!envId) {
    console.error('\n[错误] 没找到已创建的环境。请先在云开发控制台创建一个【免费体验版】环境：');
    console.error('  云开发控制台 → 新建环境 → 选「免费体验版」（0 元/月）');
    console.error('  创建好拿到环境 ID 后，重跑：node deploy-cloudbase.js --env <环境ID>\n');
    process.exit(1);
  }
  log('使用环境：' + envId);
  execFileSync(bin, ['env', 'use', envId], { stdio: 'pipe' });
  return envId;
}

// 准备函数目录：把最新的 core.js 复制进来，保证和本地同步；补 package.json
function prepareFnDir() {
  fs.copyFileSync(path.join(ROOT, 'core.js'), path.join(CLOUDBASE_DIR, 'core.js'));
  ok('已同步 core.js 到函数目录');
  const pkg = path.join(CLOUDBASE_DIR, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({ name: FN, version: '1.0.0', main: 'index.js' }, null, 2) + '\n');
    ok('生成函数 package.json');
  }
}

// 部署云函数 + 开 HTTP 访问
function deploy(bin, envId) {
  prepareFnDir();
  log('部署云函数 ' + FN + '（首次上传可能要一两分钟）...');
  try {
    execFileSync(bin, ['fn', 'deploy', FN, '--path', CLOUDBASE_DIR, '--override', '--httpFn'], { stdio: 'inherit' });
  } catch (e) {
    // 某些版本不带 --httpFn，退一步用普通部署 + 单独开 HTTP 访问
    log('（--httpFn 不被支持，改用普通部署）');
    execFileSync(bin, ['fn', 'deploy', FN, '--path', CLOUDBASE_DIR, '--override'], { stdio: 'inherit' });
  }
  ok('函数部署完成');

  log('开启 HTTP 访问服务（让外网能直接 https 访问）...');
  try {
    execFileSync(bin, ['service', 'create', '-f', FN, '-p', '/' + FN], { stdio: 'inherit' });
  } catch (e) {
    console.warn('  [提示] 自动开 HTTP 访问失败，请到控制台手动开：');
    console.warn('        云开发 → 环境 → HTTP 访问服务 → 新建，函数选 ' + FN + '，路径 /' + FN);
  }
}

// 拿固定地址 + 写进源码 + 打包
function wireAndBuild(url) {
  log('写入公网地址 → ' + url);
  execFileSync(process.execPath, ['set-base.js', url], { cwd: ROOT, stdio: 'inherit' });
  if (NO_BUILD) { log('跳过打包（--no-build）'); return; }
  log('重新打包 rpk（aiot build）...');
  execFileSync('npm', ['run', 'build'], { cwd: REPO, stdio: 'inherit' });
  ok('打包完成，新 rpk 已生成');
}

async function main() {
  if (HELP) return showHelp();

  if (wireUrl) {
    log('已有地址，跳过部署：' + wireUrl);
    wireAndBuild(wireUrl.replace(/\/+$/, ''));
    log('完成。把新 rpk 装到手环即可联网。');
    return;
  }

  const bin = await ensureTcb();
  auth(bin);
  const envId = resolveEnv(bin);
  deploy(bin, envId);

  const url = `https://${envId}.service.tcloudbase.com/${FN}`;
  log('──────────────────────────────────────────');
  log('服务器已上线（国内·固定地址）：' + url);
  log('① 手机流量打开 ' + url + '/health 确认通');
  log('② 把新 rpk 装到手环：dist/com.lilin.deltaforce.debug.*.rpk');
  log('③ 以后改了代码，重跑本脚本即可更新（地址不变）');
  log('④ 不想用了：到控制台销毁免费环境（免费环境不收费）');
  log('──────────────────────────────────────────');

  wireAndBuild(url);
}

main().catch(e => { console.error('[deploy-cloudbase] 失败:', e.message); process.exit(1); });
