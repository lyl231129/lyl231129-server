#!/usr/bin/env node
/**
 * deploy-render.js —— 部署到 Render 免费档（海外·真免费·固定域名·不用常开电脑）
 *
 * 为什么是 Render：2026 年唯一还活着的「真·永久免费」通用 PaaS。
 *   - 免费 Web Service：750 小时/月（够 1 个服务 24/7）、512MB RAM、100GB 带宽
 *   - 固定域名  https://<服务名>.onrender.com ，HTTPS，地址不变
 *   - 不需要信用卡、不用你电脑常开、代码零改动（server.js 已支持 PORT 环境变量）
 *
 * 代价（务必看）：
 *   - 免费档 15 分钟无访问会休眠，下次访问冷启动 30~60 秒（手环偶尔请求能接受，
 *     想要零冷启动就每 10 分钟用 UptimeRobot 之类 ping 一下 /health）
 *   - 部署要连一次 GitHub（一次性，界面英文但步骤简单，下面都写清楚了）
 *   - 海外节点，国内访问可能比国内云慢一点
 *
 * 使用流程（详细中文步骤见脚本 --init 打印的内容）：
 *   1) 本机跑  node deploy-render.js --init   生成 render.yaml + 初始化 git 仓库
 *   2) 去 GitHub 建一个空仓库，把本目录 push 上去
 *   3) 去 render.com 控制台 New → Web Service → 连 GitHub → 选你的仓库（自动读 render.yaml）
 *   4) 部署完拿到  https://xxxx.onrender.com  地址
 *   5) 跑  node deploy-render.js --wire https://xxxx.onrender.com   写进手环源码 + 重打包
 *
 * 参数：
 *   --init          生成 render.yaml + .gitignore 并初始化本地 git 仓库（首次用）
 *   --wire <URL>    直接写入该公网地址（跳过部署，改源码 + 重打包）
 *   --no-build      只改源码、不重打包 rpk（调试用）
 *   --check         查看当前 BASE 地址
 *   --reset         恢复占位符（离线模式）
 *   --help          显示帮助
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');          // deltaforce/
const SERVER_DIR = __dirname;                      // deltaforce/server/
const SET_BASE = path.join(SERVER_DIR, 'set-base.js');
const API_FILE = path.join(ROOT, 'src', 'common', 'api.js');
const PLACEHOLDER = 'https://REPLACE_ME_HOST';
const RENDER_YAML = path.join(SERVER_DIR, 'render.yaml');
const GITIGNORE = path.join(SERVER_DIR, '.gitignore');

function runNode(script, args, opts) {
  return spawnSync(process.execPath, [script, ...args], Object.assign({ stdio: 'inherit' }, opts));
}
function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
}
function currentBase() {
  try {
    const s = fs.readFileSync(API_FILE, 'utf8');
    const m = s.match(/const BASE = '([^']*)'/);
    return m ? m[1] : null;
  } catch (e) { return null; }
}

const RENDER_YAML_CONTENT = `services:
  - type: web
    name: lyl231129-server
    runtime: node
    plan: free
    branch: main
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
`;

const GITIGNORE_CONTENT = `node_modules/
dist/
data/admin.json
*.log
`;

function ensureFiles() {
  let made = [];
  if (!fs.existsSync(RENDER_YAML)) { fs.writeFileSync(RENDER_YAML, RENDER_YAML_CONTENT, 'utf8'); made.push('render.yaml'); }
  if (!fs.existsSync(GITIGNORE)) { fs.writeFileSync(GITIGNORE, GITIGNORE_CONTENT, 'utf8'); made.push('.gitignore'); }
  return made;
}

const HELP = `
deploy-render.js —— 部署到 Render 免费档（海外·真免费·固定域名）

首次： node deploy-render.js --init       生成配置 + 初始化 git 仓库
部署后： node deploy-render.js --wire https://xxxx.onrender.com   写地址并打包
调试：   node deploy-render.js --wire <URL> --no-build           只写不改包
查看：   node deploy-render.js --check                         看当前地址
复位：   node deploy-render.js --reset                         恢复离线模式

注意：免费档 15 分钟无访问会休眠，冷启动 30~60 秒；部署需连一次 GitHub。
`;

function main() {
  const argv = process.argv.slice(2);
  const noBuild = argv.includes('--no-build');

  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); process.exit(0); }
  if (argv.includes('--check') || argv.includes('--reset')) {
    runNode(SET_BASE, [argv.includes('--check') ? '--check' : '--reset']);
    process.exit(0);
  }

  const wireIdx = argv.indexOf('--wire');
  const wireUrl = wireIdx !== -1 ? argv[wireIdx + 1] : null;

  if (wireUrl) { doWire(wireUrl, noBuild); return; }

  // 默认 = 初始化本地部署材料
  doInit();
}

function doInit() {
  const made = ensureFiles();
  if (made.length) console.log('已生成：' + made.join('、'));
  else console.log('render.yaml / .gitignore 已存在，跳过生成。');

  // git 初始化
  if (!fs.existsSync(path.join(SERVER_DIR, '.git'))) {
    console.log('\n→ 初始化本地 git 仓库...');
    run('git', ['init', '-q'], { cwd: SERVER_DIR });
    run('git', ['branch', '-M', 'main'], { cwd: SERVER_DIR });
    run('git', ['add', '-A'], { cwd: SERVER_DIR });
    run('git', ['commit', '-q', '-m', 'feat: lyl231129 game server for Render deploy'], { cwd: SERVER_DIR });
    console.log('  已创建初始提交。');
  } else {
    console.log('\n→ 已有 git 仓库，跳过 init。如需重新提交改动：git add -A && git commit -m "update"');
  }

  console.log(`
────────────────────────────────────────────────────────
 接下来这几步（一次性，界面是英文但很简单）：

 ① 去 GitHub 建一个空仓库（github.com → New repository，名字随便，如 lyl-server）
 ② 把本目录推上去：
      cd ${SERVER_DIR}
      git remote add origin https://github.com/<你的用户名>/<仓库名>.git
      git push -u origin main
    （没有 GitHub 账号就先注册一个，免费）

 ③ 去 render.com 控制台：
      New → Web Service → 选 "Connect a GitHub repo" → 授权 → 选刚才的仓库
      Render 会自动读 render.yaml，直接点 Create Web Service 即可
      免费档默认 15 分钟休眠，可在设置里看到（想零冷启动就升级 $7/mo Starter）

 ④ 部署完成后，控制台会给你一个地址，形如：
      https://lyl231129-server.onrender.com
    把地址填进下面这条命令，本脚本会自动改源码 + 重打包 rpk：
      node deploy-render.js --wire https://lyl231129-server.onrender.com

 ⚠️ 因为是免费档，15 分钟没人访问会休眠，手环第一次请求要等 30~60 秒冷启动。
    想一直热着：用 UptimeRobot 免费版每 10 分钟 ping 一下你的 /health 地址。
────────────────────────────────────────────────────────
`);
}

function doWire(url, noBuild) {
  url = (url || '').replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) {
    console.error('[错误] 地址必须是 https:// 开头。手环走手机代理，明文 http 连不上。');
    process.exit(1);
  }
  console.log('→ 写入手环源码：' + url);
  const r = runNode(SET_BASE, [url]);
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);

  if (noBuild) {
    console.log('\n[--no-build] 已跳过打包。需要时手动跑：cd .. && npx -y aiot-toolkit@2.0.5 build');
    finish(url);
    return;
  }
  console.log('\n→ 重新打包 rpk（地址写死在包里，必须重打包）...');
  const b = run('npx', ['-y', 'aiot-toolkit@2.0.5', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) {
    console.error('\n[错误] rpk 打包失败，请手动在 deltaforce/ 目录跑 npx -y aiot-toolkit@2.0.5 build');
    process.exit(b.status === null ? 1 : b.status);
  }
  finish(url);
}

function finish(url) {
  console.log('\n✅ 完成。当前服务器地址：' + url);
  console.log('   手环装好新 rpk 后，交易行/云存档/通讯即可联网。');
  console.log('   ⚠️ Render 免费档 15 分钟无访问会休眠，首次请求冷启动 30~60 秒。');
  console.log('   ⚠️ 想一直热着就用 UptimeRobot 每 10 分钟 ping 你的 /health。');
}

main();
