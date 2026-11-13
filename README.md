# QQ经典农场 · Code 抓取（Quantumult X）

手机 QQ 打开「QQ经典农场」时，把登录用的一次性 `code` 抓下来，自动传进面板并让账号上线。

只读旁路：不改请求、不改响应、不伪造流量。

> 仓库：`ngtxyaa/qq-farm-qx`，分支 `main`。下面的两条订阅地址可直接使用。

## 安装

**两步，都不用手写规则。**

### 1. QX 添加一条远程重写

设置 → 重写 → 引用 → 右上角 `+`，粘贴：

```
https://raw.githubusercontent.com/ngtxyaa/qq-farm-qx/main/qqfarm.rewrite.conf
```

资源标签填 `QQ农场`，保存后打开开关。MITM 域名、抓取规则、脚本地址都在这个文件里，
QX 会自动同步，**不需要你手动添加 `[mitm]` 或往本地塞脚本文件**。

### 2. BoxJs 添加订阅

BoxJs →「应用」→「添加订阅」，粘贴：

```
https://raw.githubusercontent.com/ngtxyaa/qq-farm-qx/main/qqfarm.boxjs.json
```

打开「QQ经典农场 · 抓码设置」，填面板地址、管理员账号、密码，打开「抓到后自动上传」，保存。

改完即生效，不用重启 QX、不用重装脚本。

### 3. QX 开三件事

设置 → 重写 **打开** ／ MITM → 生成证书 → 安装到 iOS ／ 设置 → 通用 → 关于本机 →
证书信任设置 → 打开 QX 证书开关。

少了第三步，HTTPS 不会被解密，脚本一次都不会触发。

## 用起来是什么样

1. 手机 QQ 打开「QQ经典农场」
2. 通知弹出「**QQ农场 Code 已上传**」
3. 面板里对应账号自动重新登录并上线

没开自动上传时通知是「Code 已捕获」，长按复制，去面板「添加账号 → Code 页签」粘贴。
code 一次性、分钟级有效，重进小程序会刷新。

## 自检（不用开 QQ）

Safari 打开：

```
https://gate-obt.nqf.qq.com/prod/ws?platform=qq&ver=1.0.0_20260101&code=QXTEST-0000-1111-2222
```

弹通知且正文是那串 → 链路通。没弹 → 重写没生效、MITM 没开或证书没信任，跟 QQ 无关。

## code 从哪来

QQ 小程序里 `qq.login()` 拿到 code 后，客户端把它拼在游戏网关的 WebSocket 地址上：

```
wss://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=ios&ver=<版本>_<日期>&code=<CODE>
```

所以抓取点只有一个：这个网关域名的握手请求。

## 文件

| 文件 | 说明 |
|---|---|
| `qqfarm.rewrite.conf` | QX 远程重写（含 MITM 域名与脚本地址） |
| `qqfarm.boxjs.json` | BoxJs 订阅：配置表单 |
| `qq-farm-code.js` | 抓取主脚本 |
| `qq-farm-code-show.js` | 回看最近抓到的 code（可选定时任务） |

## 配置项

BoxJs 表单里的九项，存在 QX 的 `$prefs`，脚本每次触发时读：

| 键 | 说明 |
|---|---|
| `qqfarm_cfg_enabled` | 抓到后自动上传的总开关 |
| `qqfarm_cfg_baseUrl` | 面板地址，如 `http://1.95.33.60:3007` |
| `qqfarm_cfg_username` / `qqfarm_cfg_password` | 面板管理员账号密码 |
| `qqfarm_cfg_target` | `name` 按备注名 ／ `account` 指定账号 |
| `qqfarm_cfg_accountName` | 账号备注名，同名覆盖 code 并重启，不重复建号 |
| `qqfarm_cfg_accountId` | 指定账号 ID，留空自动退回按备注名 |
| `qqfarm_cfg_platform` | `qq` ／ `wx` |
| `qqfarm_cfg_notify` | 是否弹通知 |

优先级：BoxJs 设置页 > 旧版 `qqfarm_cfg` JSON > 脚本里 `CFG.panel`。

## 排障

| 现象 | 处理 |
|---|---|
| 抓不到，日志里没有 `[QQFarm]` | 远程重写没生效：确认已开启该资源、MITM 已开、证书已信任 |
| 有 `[QQFarm] 跳过` | 命中了但 URL 里没 code，把脚本里 `CFG.debug` 置 `true` 看具体 url |
| 上传失败：未配置面板密码 | BoxJs 里密码没填或没保存 |
| 上传失败：登录失败 | 面板密码错，或 IP 被限流（每分钟 10 次、连续失败 5 次锁 15 分钟） |
| 一个请求都看不到 | QQ 若对网关做证书固定，QX 无法解密，改用面板自带的抓包代理 |

## 与微信版的区别

微信侧有 `expires_at` / `refreshtoken`，可提前换 code；QQ 侧没有，code 失效只能等掉线再抓。

## 更新脚本

改完脚本直接提交到 `main` 即可。QX 会按自己的周期同步远程重写，BoxJs 订阅需手动
点一下刷新。若走 jsDelivr 镜像，要等缓存过期（几分钟）。

## 地址拉不动怎么办

`raw.githubusercontent.com` 在国内部分网络下会超时。QX 里可以先确认这条域名走的是代理，
或者把两处地址换成 jsDelivr 镜像：

```
https://cdn.jsdelivr.net/gh/ngtxyaa/qq-farm-qx@main/qqfarm.rewrite.conf
https://cdn.jsdelivr.net/gh/ngtxyaa/qq-farm-qx@main/qqfarm.boxjs.json
```

镜像有缓存，改完脚本要等几分钟才生效；调试阶段建议仍用 raw。
