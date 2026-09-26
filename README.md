# 站点 + 游戏后端（一体化）

一个零依赖的 Node.js 服务，同时干两件事：托管 lyl231129 的个人主页，以及给手环游戏提供接口。

```bash
node server.js                 # 启动，默认 8080
PORT=3000 node server.js       # 换端口
node server.js --build         # 导出纯静态站到 dist/（可部署到静态托管）
ADMIN_TOKEN=xxx node server.js # 自定义管理密钥
```

## 路由

| 路径 | 说明 |
|---|---|
| `/` | 个人主页（游戏列表由服务端注入 HTML，静态导出也会烘焙） |
| `/delta/` | 三角洲行动 · 玩家站（网页版挂单 / 撤单 / 存档 / 通讯） |
| `/dl/文件名` | 提供 `downloads/` 目录里的文件（`.rpk` 等），自动累加下载次数 |
| `/health` | 健康检查 + 统计 |
| `GET /api/games` | 已发布游戏列表 |
| `POST /api/games` | 新增游戏（需管理密钥） |
| `PUT/PATCH /api/games/:id` | 改游戏（需管理密钥） |
| `DELETE /api/games/:id` | 删游戏（需管理密钥） |
| `GET /api/orders` | 交易行在架挂单，`?item=` `?type=` `?user=` 可过滤 |
| `POST /api/orders` | 上架 `{user,item,price,type}` |
| `POST /api/orders/:id/cancel` | 撤单。**手环端不带 body 也能撤**；带了 user 就必须匹配 |
| `POST /api/sync` | 上传存档 `{user,data}` |
| `GET /api/sync/:user` | 拉取存档 |
| `GET /api/messages` | 战场通讯（最近 100 条） |
| `POST /api/messages` | 发消息 `{user,text}` |
| `GET /api/stats` | 统计数字（页面状态条用） |
| `POST /api/hit` | 访问计数 |
| `GET /api/files` | `downloads/` 目录清单 + 每个文件的下载次数 |

## 管理密钥

第一次启动会生成 `data/admin.json`（里面是随机 token，也会打印在启动日志里）。
写接口要带这个 token：

```bash
curl -X POST http://localhost:8080/api/games \
  -H "Content-Type: application/json" \
  -H "x-admin-token: 你的token" \
  -d '{"name":"新游戏","desc":"一句话简介","tags":"动作,联网","version":"1.0.0","file":"xxx.rpk"}'
```

字段说明：`cover` 截图地址、`file` 是 `downloads/` 里的文件名（走 `/dl/`，会计数）、
`link` 是外链（网盘或帖子）、`status` 填 `hidden` 可临时下架。

## 数据

`data/db.json`，结构：`games` / `orders` / `saves` / `messages` / `downloads` / `visits`。
写入是防抖 200ms + 临时文件原子替换，Ctrl+C 退出时会再存一次。

## 静态导出（部署用）

```bash
node server.js --build
```

产出 `dist/`：`index.html`（游戏数据已烘焙进去）、`delta.html`、`games.json`。
整个目录可以直接丢到任何静态托管上——但 `/api/*` 和 `/dl/` 就没了，
所以**游戏包的下载链接建议用 `link` 字段（网盘）**，静态站上点得动。

## 云函数版（公网 HTTPS）

手环自己不能上网，请求由手机「小米运动健康」代理转发，
**所以接口地址必须是公网 HTTPS**，`localhost` 和内网 IP 都不行。

`cloudbase/index.js` 是腾讯云开发 CloudBase 的云函数版本，`core.js` 与本地版共用，
接口路径完全一致——迁过去只换 `src/common/api.js` 里的 `BASE`，手环代码不用改。

上传时把 `cloudbase/index.js` 和 `core.js` 放在同一个函数目录里（平级）。

> 云函数磁盘不保证持久，正式运营把 core.js 里的 loadDb/saveDb 换成云数据库。

## 内网穿透（不想买服务器就用这个）

本机跑 `server.js`，再用穿透工具换一个公网 HTTPS 地址，手环就能连上。四步：

```bash
# ① 起服务（默认监听 0.0.0.0:8080，局域网也能访问）
node server.js

# ② 装穿透工具，把本机 8080 映射出去，拿到 https 地址
#    cpolar:   cpolar http 8080
#    花生壳:   客户端里新建映射，内网端口 8080
#    natapp:   natapp -authtoken=你的token

# ③ 把地址写进手环源码
node set-base.js https://你拿到的地址

# ④ 重新打包（地址是写死进 rpk 的，改完必须重打包）
cd .. && npx -y aiot-toolkit@2.0.5 build
```

`set-base.js` 的其他用法：

```bash
node set-base.js --check    # 看当前配的地址
node set-base.js --reset    # 恢复占位符，游戏回到离线模式
```

### ⚠️ 挑工具前先看这条

内网穿透类免费方案有两个绕不开的代价：

1. **你电脑得一直开着、网络得通**，关机手环瞬间连不上。
2. **免费版端口通常是随机的**，地址会变 → 得重跑 `set-base` + 重新打包 + 重装游戏。

| 方案 | 域名/端口 | 说明 |
|---|---|---|
| **花生壳免费版** | 域名固定·端口随机 | 送 1 个壳域名（1年可续）、**真免费**；但外网端口系统随机分配会变、要实名、流量约1G/月、带宽低、电脑须常开。长期免费的代价就是端口一变要重装游戏 |
| cpolar 付费基础版 | 固定子域名 | 一年几十块，速度和稳定性更好，端口固定不用重装 |
| cpolar / natapp 免费版 | 每次变 | 只适合临时验证「能不能通」，不适合长期 |
| 云服务器 / CloudBase 个人版 | 固定 | 最省心、不依赖你电脑开着，但要付费（¥19.9/月起） |

### 验证通没通

拿到地址后先自己验一下，别急着打包：

```bash
curl https://你拿到的地址/health
```

返回 `{"ok":true,...}` 就是通的。再用手机流量（别连 WiFi）访问一次同样的地址，
确认外网能打开——因为手环的请求是手机转发出去的。

## 免费云端部署（固定域名，不想折腾就用这个）

不想买服务器、也不想忍受 cloudflared 每次变域名，就把服务器部署到免费云平台，拿一个**固定的 `*.fly.dev` 域名**，部署一次长期用，不用反复重打包。

脚本会帮你装 CLI、登录、部署、拿地址、改源码、打包，一条命令跑完：

```bash
node deploy-cloud.js                 # 全自动（fly.io 免费额度）
node deploy-cloud.js --no-build      # 只部署+拿地址+改源码，不重打包（调试）
node deploy-cloud.js --token <TK>    # 用 API token 免交互登录（CI/无浏览器）
node deploy-cloud.js --region hkg    # 换区域（默认 nrt=东京，离国内近）
node deploy-cloud.js --wire <URL>    # 已部署过，跳过部署只改源码+打包
```

前提（一次性）：注册一个免费的 fly.io 账号（https://fly.io），首次运行脚本会自动装好 flyctl 并打开浏览器登录。免费额度够一个小游戏服务器；fly 可能要求绑一张卡防滥用，但不会扣费。

部署后手环端地址写死进 rpk，把新 rpk 装到手环就能联网。以后改了代码重跑本脚本即可更新，**地址不变**。

> 免费机器空闲会休眠，下次访问冷启动约几秒，属正常。
> 免费磁盘不持久，`data/db.json` 重启会重置——演示/交易行/存档用足够；要持久数据请换 CloudBase 或挂持久卷。
> 想要国内更稳、界面全中文，就用下面的「腾讯云 CloudBase」，`deploy-cloudbase.js` 已写好。

## 国内·腾讯云 CloudBase（全中文·免费体验版）

不想用英文平台、想要国内服务器，就用这个。腾讯云 CloudBase 是**全中文**的，有「免费体验版」：
**0 元/月、每月 3000 资源点、有效期 6 个月（活动期内可 0 元续 6 个月）**，云函数调用 13.3 点/万次，一个小游戏服务器够用。

脚本会帮你装 CLI、登录、选环境、部署成 HTTP 云函数、开 HTTP 访问、拿固定地址、改源码、打包：

```bash
node deploy-cloudbase.js                      全自动（需先建好免费环境并 tcb login）
node deploy-cloudbase.js --env <环境ID>       指定环境，跳过自动选
node deploy-cloudbase.js --no-build           只部署+拿地址+改源码，不重打包（调试）
node deploy-cloudbase.js --apiKeyId <ID> --apiKey <KEY>   密钥免交互登录
node deploy-cloudbase.js --wire <URL>         已部署过，跳过部署只改源码+打包
```

首次一次性准备（都在中文控制台点，不用看英文）：

1. 注册腾讯云账号并完成**实名认证**（国内云都跑不掉，几分钟）。
2. 开通云开发，新建一个**免费体验版**环境，拿到环境 ID（形如 `xxxxx-envabc`）。
3. 本机装 CLI 并登录：
   ```bash
   npm install -g @cloudbase/cli
   tcb login        # 弹中文浏览器，扫码/授权
   ```
4. 跑脚本（把环境 ID 用 `--env` 传进去）：
   ```bash
   node deploy-cloudbase.js --env <环境ID>
   ```

部署后手环端地址写死进 rpk，把新 rpk 装到手环就能联网，地址固定不变。

> 免费体验版磁盘不持久，环境回收后 `data/db.json` 会丢（演示/交易行/存档够用）；正式运营把 `core.js` 里的 `loadDb/saveDb` 换成 CloudBase 云数据库。
> 免费环境有资源点上限，超了限流；长期运营建议升「个人版」（¥19.9/月）。

## 花生壳免费版一键脚本（deploy-oray.js）

游戏要**长期对外运营又只想免费**，就走花生壳免费版：真免费、国内、中文、送壳域名。
上面的表也写了代价：端口随机（变了要重装游戏）、流量约 1G/月、带宽低、电脑须常开、要实名。

脚本把「改源码 + 重打包」自动化，省掉手动步骤：

```bash
node deploy-oray.js --wire https://xxxx.xicp.net:54321   写入地址并打包
node deploy-oray.js --wire https://xxxx.xicp.net:54321 --no-build   只写不改包（调试）
node deploy-oray.js                                    交互式粘贴地址
node deploy-oray.js --check                            查看当前地址
node deploy-oray.js --reset                            恢复离线模式
```

使用流程：

1. 装好花生壳客户端并登录（https://hsk.oray.com/download），**15 天内完成实名认证**。
2. 花生壳里【添加映射】：应用类型 **HTTPS**、内网主机 `127.0.0.1`、内网端口 `8080`、外网端口选**动态端口（免费）**。
   保存后得到形如 `https://xxxx.xicp.net:54321` 的地址。
3. 本地服务器先跑起来（双击 `start.bat` 或 `node server.js`）。
4. 跑 `node deploy-oray.js --wire <上面的地址>`，脚本改源码 + 重打包 rpk。

> ⚠️ 花生壳免费版端口随机：一旦花生壳重连 / 端口被回收，地址端口会变 → 重跑 `node deploy-oray.js --wire <新地址>` 并重新安装游戏即可。
> ⚠️ 本地服务器（`start.bat` / `node server.js`）必须一直开着，否则手环连不上。
> ⚠️ 流量约 1G/月，超了收费；游戏包下载量上来后留意用量。

## 目录

```
server/
  server.js       HTTP 服务 + 静态托管 + --build
  set-base.js     一键改手环源码里的服务器地址（--check / --reset）
  deploy-cloud.js      一键部署到免费云平台拿固定域名（fly.io，国外）
  deploy-cloudbase.js  一键部署到腾讯云 CloudBase（国内·中文·免费体验版）
  deploy-oray.js       花生壳免费版一键接入（改源码 + 重打包，国内·真免费·需电脑常开）
  core.js         业务逻辑（server.js 与云函数共用）
  cloudbase/      CloudBase 云函数目录（index.js + core.js + package.json）
  public/         index.html 个人主页 · delta.html 玩家站
  downloads/      放 .rpk 等下载文件
  data/           db.json 数据 · admin.json 管理密钥
  dist/           --build 产出的静态站
  package.json    npm start = node server.js（云平台用）
  fly.toml        fly.io 部署配置（脚本自动生成）
  .dockerignore   部署时排除本地杂项
```
