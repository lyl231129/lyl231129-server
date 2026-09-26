#!/usr/bin/env node
/**
 * deploy-oray.js —— 花生壳免费版一键接入（国内 · 真免费 · 免服务器）
 *
 * 适用场景：
 *   手环游戏要长期对外运营，但只想用免费方案。花生壳免费版：
 *     - 送 1 个壳域名（xxx.xicp.net），有效期 1 年、可续
 *     - 外网端口是【动态端口 = 系统随机分配】，固定端口要花钱买
 *     - 每月约 1G 流量，超了收费；免费带宽较低
 *     - 客户端必须一直开着，否则手环瞬间连不上
 *     - 15 天内必须实名认证，否则域名锁定
 *
 * 重要提醒（务必看）：
 *   因为免费版端口是随机的，每次花生壳重连/重启、或端口被回收后，
 *   外网地址里的「端口号」会变 → 手环源码里的 BASE 和打好的 rpk
 *   就得跟着改 → 必须重装游戏。这是免费版的硬伤，脚本只能帮你
 *   「一键改地址 + 重打包」，省掉手动步骤，但变端口这件事躲不掉。
 *
 * 使用流程：
 *   1) 装好花生壳客户端并登录（https://hsk.oray.com/download）
 *   2) 在花生壳里【添加映射】：
 *        应用类型：HTTPS
 *        内网主机：127.0.0.1
 *        内网端口：8080        （即本地 node server.js 监听的端口）
 *        外网端口：动态端口（免费，系统随机分配）
 *      保存后会得到一个形如  https://xxxx.xicp.net:54321  的地址
 *   3) 先确保本地服务器在跑：双击 start.bat  （或 node server.js）
 *   4) 跑本脚本把地址写进手环源码并重新打包 rpk：
 *        node deploy-oray.js --wire https://xxxx.xicp.net:54321
 *
 * 参数：
 *   --wire <URL>   直接写入该公网地址（跳过交互）
 *   --no-build     只改源码、不重打包 rpk（调试用）
 *   --check        查看当前 BASE 地址
 *   --reset        恢复占位符（离线模式）
 *   --help         显示帮助
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');          // deltaforce/
const SERVER_DIR = __dirname;                       // deltaforce/server/
const SET_BASE = path.join(SERVER_DIR, 'set-base.js');
const API_FILE = path.join(ROOT, 'src', 'common', 'api.js');
const PLACEHOLDER = 'https://REPLACE_ME_HOST';

function runNode(script, args, opts) {
  return spawnSync(process.execPath, [script, ...args], Object.assign({ stdio: 'inherit' }, opts));
}

function currentBase() {
  try {
    const s = fs.readFileSync(API_FILE, 'utf8');
    const m = s.match(/const BASE = '([^']*)'/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

const HELP = `
deploy-oray.js —— 花生壳免费版一键接入

前置条件：
  1. 已装花生壳客户端并登录，且完成实名认证
  2. 已在花生壳添加一条 HTTPS 映射（内网 127.0.0.1:8080，外网动态端口）
  3. 本地服务器已在跑（双击 start.bat 或 node server.js）

用法：
  node deploy-oray.js --wire https://xxxx.xicp.net:54321   写入地址并打包
  node deploy-oray.js --wire https://xxxx.xicp.net:54321 --no-build   只写不改包
  node deploy-oray.js                                         交互式输入地址
  node deploy-oray.js --check                                 查看当前地址
  node deploy-oray.js --reset                                 恢复离线模式

注意：花生壳免费版端口是随机的，端口一变就要重跑本脚本 + 重装游戏。
`;

function main() {
  const argv = process.argv.slice(2);
  const args = argv.filter(a => a !== '--no-build');
  const noBuild = argv.includes('--no-build');

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  // 透传 --check / --reset
  if (argv.includes('--check') || argv.includes('--reset')) {
    const flag = argv.includes('--check') ? '--check' : '--reset';
    runNode(SET_BASE, [flag]);
    process.exit(0);
  }

  // 取地址
  let url = null;
  const wireIdx = argv.indexOf('--wire');
  if (wireIdx !== -1 && argv[wireIdx + 1]) {
    url = argv[wireIdx + 1];
  }

  if (!url) {
    // 交互式
    const cur = currentBase();
    if (cur && cur !== PLACEHOLDER) {
      console.log('当前地址：' + cur);
    }
    console.log('请把花生壳映射得到的地址粘贴进来（形如 https://xxxx.xicp.net:54321）：');
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question('> ', (ans) => {
      rl.close();
      const u = (ans || '').trim();
      if (!u) { console.error('未输入地址，已取消。'); process.exit(1); }
      doWrite(u, noBuild);
    });
    return;
  }

  doWrite(url, noBuild);
}

function doWrite(url, noBuild) {
  url = url.replace(/\/+$/, '');
  if (!/^https:\/\//i.test(url)) {
    console.error('[错误] 地址必须是 https:// 开头。手环走手机代理，明文 http 连不上。');
    console.error('       你拿到的是：' + url);
    process.exit(1);
  }

  // 提示端口随机的坑
  const hasPort = /:\d+$/.test(url);
  if (!hasPort) {
    console.warn('[提醒] 这个地址没有端口号。花生壳免费版一般是 https://域名:端口 形式，');
    console.warn('       如果你拿到的确实是这种（不带端口），请确认映射类型选的是 HTTPS。\n');
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
  const b = spawnSync('npx', ['-y', 'aiot-toolkit@2.0.5', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) {
    console.error('\n[错误] rpk 打包失败，请手动在 deltaforce/ 目录跑 npx -y aiot-toolkit@2.0.5 build');
    process.exit(b.status === null ? 1 : b.status);
  }
  finish(url);
}

function finish(url) {
  console.log('\n✅ 完成。当前服务器地址：' + url);
  console.log('   手环装好新 rpk 后，交易行/云存档/通讯即可联网。');
  console.log('   ⚠️ 花生壳免费版端口是随机的：一旦花生壳重连/端口回收，地址端口会变，');
  console.log('      届时重跑  node deploy-oray.js --wire <新地址>  并重新安装游戏即可。');
  console.log('   ⚠️ 本地 node server.js（或 start.bat）必须一直开着，否则手环连不上。');
}

main();
