#!/usr/bin/env node
/**
 * set-base.js —— 一键把手环源码里的服务器地址改掉
 *
 *   用法：
 *     node set-base.js https://你的公网地址       写入新地址
 *     node set-base.js --check                   查看当前地址
 *     node set-base.js --reset                   恢复成占位符（离线模式）
 *
 * 说明：
 *   手环自己不能上网，请求由手机「小米运动健康」代理转发，
 *   所以地址必须是**公网 HTTPS**。localhost / 192.168.x.x 一律连不上。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const API_FILE = path.join(__dirname, '..', 'src', 'common', 'api.js');
const PLACEHOLDER = 'https://REPLACE_ME_HOST';
const RE = /const BASE = '[^']*'/;

function current() {
  const s = fs.readFileSync(API_FILE, 'utf8');
  const m = s.match(/const BASE = '([^']*)'/);
  return m ? m[1] : null;
}

function write(url) {
  let s = fs.readFileSync(API_FILE, 'utf8');
  if (!RE.test(s)) {
    console.error('[错误] 在 api.js 里没找到 "const BASE = \'...\'" 这一行，未做任何修改。');
    process.exit(1);
  }
  s = s.replace(RE, "const BASE = '" + url + "'");
  fs.writeFileSync(API_FILE, s, 'utf8');
}

const arg = (process.argv[2] || '').trim();

if (!arg || arg === '--check') {
  const c = current();
  console.log('当前地址：' + c);
  if (c === PLACEHOLDER) {
    console.log('状态：    未配置（离线模式，交易行/云存档不可用）');
  } else if (!/^https:\/\//.test(c || '')) {
    console.log('状态：    不是 https:// 开头，手环可能连不上');
  } else {
    console.log('状态：    已配置');
  }
  process.exit(0);
}

if (arg === '--reset') {
  write(PLACEHOLDER);
  console.log('已恢复占位符，游戏回到离线模式。');
  process.exit(0);
}

let url = arg.replace(/\/+$/, '');

if (!/^https?:\/\//i.test(url)) {
  console.error('[错误] 地址要以 http:// 或 https:// 开头，例如：');
  console.error('       node set-base.js https://abc123.cpolar.cn');
  process.exit(1);
}

if (!/^https:\/\//.test(url)) {
  console.warn('[警告] 你填的是 http（不是 https）。');
  console.warn('       手环的请求走手机代理转发，明文 http 大概率被系统拦截或失败。');
  console.warn('       仍然写入了，出问题记得换回 https。\n');
}

const before = current();
write(url);
console.log('已写入 ' + path.relative(process.cwd(), API_FILE));
console.log('  旧: ' + before);
console.log('  新: ' + url);

// 自检：只校验 BASE 这一行的值，别把代码里别的 "REPLACE_ME" 字样算进来
const after = current();
if (after !== url) {
  console.error('[错误] 写回后读到的值是 "' + after + '"，与预期不符。');
  process.exit(1);
}
if (after.indexOf('REPLACE_ME') !== -1) {
  console.error('[错误] 地址仍是占位符。');
  process.exit(1);
}
console.log('\n下一步：重新打包 rpk（地址是写死进包的，改完必须重打包）：');
console.log('  cd .. && npx -y aiot-toolkit@2.0.5 build');
