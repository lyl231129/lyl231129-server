#!/usr/bin/env node
/**
 * deploy-cloud.js —— 一条命令把游戏服务器部署到免费云平台，拿到固定公网 HTTPS 地址
 *
 * 默认平台：fly.io（免费额度、固定 *.fly.dev 域名、纯命令行部署，不用连 GitHub）
 * 域名是固定的，部署一次长期用，不用像 cloudflared 那样每次重打包。
 *
 * 用法：
 *   node deploy-cloud.js                 全自动：装 CLI → 登录 → 部署 → 拿地址 → 改源码 → 打包
 *   node deploy-cloud.js --no-build      只部署+拿地址+改源码，不重打包 rpk（调试用）
 *   node deploy-cloud.js --token <FLY_API_TOKEN>   用 token 免交互登录（CI/无浏览器环境）
 *   node deploy-cloud.js --region hkg    换区域（默认 nrt=东京，离国内近）
 *   node deploy-cloud.js --wire https://已有地址   已部署过，跳过部署只改源码+打包
 *   node deploy-cloud.js --help           看帮助
 *
 * 前提（一次性）：
 *   - 需要免费的 fly.io 账号（https://fly.io）。首次运行脚本会帮你装好 flyctl 并打开浏览器登录。
 *   - 免费额度通常够一个小游戏服务器；fly 可能要求绑一张卡用于防滥用，但不会扣费。
 *
 * 说明：
 *   - 手环请求走手机转发，必须是公网 HTTPS，localhost/内网 IP 不行。
 *   - 免费机器空闲会休眠，下次访问冷启动约几秒，属正常。
 *   - 免费平台的磁盘不持久，data/db.json 重启会重置（交易行/存档数据适合放这里做演示）。
 *     要持久数据请改用腾讯云 CloudBase（cloudbase/index.js 已备好）或挂一个持久卷。
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;                                  // server/
const REPO = path.join(ROOT, '..');                      // deltaforce/
const PLATFORM = 'fly';
const DEFAULT_REGION = 'nrt';
const FLY_HOME = path.join(os.homedir(), '.fly', 'bin', 'flyctl.exe');

const args = process.argv.slice(2);
const NO_BUILD = args.includes('--no-build');
const HELP = args.includes('--help') || args.includes('-h');
const region = (() => { const i = args.indexOf('--region'); return i >= 0 ? args[i + 1] : DEFAULT_REGION; })();
const token = (() => { const i = args.indexOf('--token'); return i >= 0 ? args[i + 1] : null; })();
const wireUrl = (() => { const i = args.indexOf('--wire'); return i >= 0 ? args[i + 1] : null; })();

const log = (...a) => console.log('[deploy-cloud]', ...a);
const ok = (...a) => console.log('  ✓', ...a);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showHelp() {
  console.log(`
deploy-cloud.js —— 部署服务器到免费云平台，拿固定公网 HTTPS 地址

  node deploy-cloud.js                  全自动部署（fly.io）
  node deploy-cloud.js --no-build       部署但不重打包 rpk
  node deploy-cloud.js --token <TK>     用 API token 免交互登录
  node deploy-cloud.js --region hkg     换区域
  node deploy-cloud.js --wire <URL>     已部署过，跳过部署只改源码+打包
  node deploy-cloud.js --help           本帮助

部署后手环端地址写死进 rpk，记得把新 rpk 装到手环即可联网。
`);
  process.exit(0);
}

// ── 生成部署所需文件（如果还没有）───────────────────────────────────────────
function ensureFiles() {
  // package.json：云平台用 npm start 起服务
  const pkg = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({
      name: 'lyl231129-server',
      version: '1.0.0',
      private: true,
      description: 'lyl231129 个人主页 + 三角洲行动游戏后端',
      scripts: { start: 'node server.js' },
      engines: { node: '>=18' },
    }, null, 2) + '\n');
    ok('生成 package.json');
  }

  // .dockerignore：别把本地杂项传上去
  const di = path.join(ROOT, '.dockerignore');
  if (!fs.existsSync(di)) {
    fs.writeFileSync(di, [
      'node_modules', 'dist', 'cloudflared.exe', 'go-live.js',
      'set-base.js', 'start.bat', '.git', '.gitignore', '*.log', 'data',
    ].join('\n') + '\n');
    ok('生成 .dockerignore');
  }
}

// ── 读/写 fly.toml，保证 app 名稳定（重部署同地址）───────────────────────────
function appName() {
  const toml = path.join(ROOT, 'fly.toml');
  if (fs.existsSync(toml)) {
    const m = fs.readFileSync(toml, 'utf8').match(/app\s*=\s*'([^']+)'/);
    if (m) return m[1];
  }
  const name = 'lyl-deltaforce-' + Math.random().toString(16).slice(2, 6);
  const content = `# 自动生成 by deploy-cloud.js —— 删掉可换 app 名（换个固定域名）
app = '${name}'
primary_region = '${region}'

[build]

[env]
  PORT = '8080'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  cpu_kind = 'shared'
  cpus = 1
  memory_mb = 256
`;
  fs.writeFileSync(toml, content);
  ok('生成 fly.toml（app=' + name + '，区域=' + region + '）');
  return name;
}

// ── 找到 flyctl 可执行文件，没有就装 ────────────────────────────────────────
function findFly() {
  try { execFileSync('flyctl', ['version'], { stdio: 'pipe' }); return 'flyctl'; } catch (e) {}
  try { execFileSync('fly', ['version'], { stdio: 'pipe' }); return 'fly'; } catch (e) {}
  if (fs.existsSync(FLY_HOME)) return FLY_HOME;
  return null;
}

async function ensureFly() {
  let bin = findFly();
  if (bin) { ok('flyctl 已就绪：' + bin); return bin; }

  log('未检测到 flyctl，自动安装（需要联网，约 30MB）...');
  const ps = 'iwr https://fly.io/install.ps1 -useb | iex';
  await new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('安装脚本退出码 ' + code)));
  });
  if (fs.existsSync(FLY_HOME)) { ok('flyctl 安装完成'); return FLY_HOME; }
  throw new Error('安装后仍未找到 ' + FLY_HOME + '，请手动装：https://fly.io/docs/hands-on/install-flyctl/');
}

// ── 登录 ────────────────────────────────────────────────────────────────────
function auth(bin) {
  if (token) {
    process.env.FLY_API_TOKEN = token;
    ok('已用 FLY_API_TOKEN 登录（非交互）');
    return;
  }
  log('打开浏览器登录 fly.io（没有账号先去 https://fly.io 注册一个免费的）...');
  log('登录完回到这里，脚本会继续。');
  try {
    execFileSync(bin, ['auth', 'login'], { stdio: 'inherit' });
    ok('登录成功');
  } catch (e) {
    throw new Error('登录失败：' + e.message + '\n可改用 node deploy-cloud.js --token <FLY_API_TOKEN> 免交互登录');
  }
}

// ── 部署 ────────────────────────────────────────────────────────────────────
function deploy(bin) {
  log('部署中（首次会构建镜像，可能要一两分钟，看网速）...');
  const cmd = [bin, 'deploy', '--region', region];
  execFileSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit' });
  ok('部署完成');
}

// ── 写地址进源码并打包 ──────────────────────────────────────────────────────
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

  ensureFiles();
  const app = appName();
  const url = `https://${app}.fly.dev`;

  if (wireUrl) {
    log('已有地址，跳过部署：' + wireUrl);
    wireAndBuild(wireUrl.replace(/\/+$/, ''));
    log('完成。把新 rpk 装到手环即可联网。');
    return;
  }

  const bin = await ensureFly();
  auth(bin);
  deploy(bin);

  log('──────────────────────────────────────────');
  log('服务器已上线（固定地址，不用重打包）：' + url);
  log('① 手机流量打开 ' + url + '/health 确认通');
  log('② 把新 rpk 装到手环：dist/com.lilin.deltaforce.debug.*.rpk');
  log('③ 以后改了代码，重跑本脚本即可更新（地址不变）');
  log('④ 不想用了：' + bin + ' apps destroy ' + app);
  log('──────────────────────────────────────────');

  wireAndBuild(url);
}

main().catch(e => { console.error('[deploy-cloud] 失败:', e.message); process.exit(1); });
