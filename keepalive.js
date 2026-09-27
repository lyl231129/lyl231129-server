#!/usr/bin/env node
/**
 * 保活脚本：定期访问 Render 免费服务的 /health，避免 15 分钟无访问后休眠（冷启动 30~60 秒）。
 *
 * 用法：
 *   node keepalive.js https://你的.onrender.com              （默认每 5 分钟一次）
 *   node keepalive.js https://你的.onrender.com 300          （每 300 秒一次）
 *   KEEPALIVE_URL=https://你的.onrender.com node keepalive.js
 *
 * 说明：
 *   - Render 免费档在 15 分钟无访问后会休眠；保持 5 分钟内一次访问即可常驻在线。
 *   - 本脚本在你的电脑上运行，电脑关机则停止保活；若要「电脑关了也保活」，请用 UptimeRobot（见 README）。
 */

const URL = process.argv[2] || process.env.KEEPALIVE_URL;
if (!URL) {
  console.error('用法: node keepalive.js https://你的.onrender.com [间隔秒数]');
  process.exit(1);
}
const intervalSec = parseInt(process.argv[3], 10) || 300;
const base = String(URL).replace(/\/+$/, '');
const target = base + '/health';

function ping() {
  const t = new Date().toLocaleString('zh-CN', { hour12: false });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  fetch(target, { signal: ctrl.signal, method: 'GET' })
    .then((r) => {
      clearTimeout(timer);
      const mark = r.status === 200 ? '✅' : '⚠️';
      console.log(`[${t}] ping ${target} -> HTTP ${r.status} ${mark}`);
    })
    .catch((e) => {
      clearTimeout(timer);
      const msg = e.name === 'AbortError' ? '超时（服务可能正在唤醒中）' : e.message;
      console.log(`[${t}] ping ${target} -> 失败: ${msg}`);
    });
}

console.log(`保活启动：每 ${intervalSec} 秒访问 ${target}`);
console.log('（Render 免费档 15 分钟无访问会休眠，保持 5 分钟内一次即可常驻在线）');
ping(); // 立即先打一次
setInterval(ping, intervalSec * 1000);
