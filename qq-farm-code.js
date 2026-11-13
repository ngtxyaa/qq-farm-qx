/**
 * QQ经典农场 · 登录 Code 抓取（Quantumult X）
 * ---------------------------------------------------------------------------
 * 原理：手机 QQ 里打开「QQ经典农场」小程序时，客户端会把 qq.login() 拿到的
 *       一次性 code 直接拼在网关 WebSocket 地址上：
 *
 *       wss://gate-obt.nqf.qq.com/prod/ws?platform=qq&os=ios&ver=xxx&code=<CODE>
 *
 *       本脚本只「读」这个 URL 里的 code，取出后通知 + 落盘 +（可选）自动
 *       上传到面板添加账号，全程不修改请求头、请求体、响应 —— 只是旁路观察。
 *
 * 类型：http-request（写成 http-response 也能用，脚本会自动识别上下文）
 * 规则：
 *   ^https?://gate-obt\.nqf\.qq\.com/ url script-request-header qq-farm-code.js
 *   若命中时上报的 URL 以 wss:// 开头（个别 QX 版本），改用：
 *   ^(https?|wss?)://gate-obt\.nqf\.qq\.com/ url script-request-header qq-farm-code.js
 *
 * 注意：code 是一次性的、有效期很短（分钟级）。重新进入小程序会刷新 code。
 *
 * 配置：不要改这里的 CFG.panel。在 BoxJs 里添加订阅（订阅地址见 README，
 *       文件是 qqfarm.boxjs.json），打开「QQ经典农场 · 抓码设置」填开关 /
 *       面板账号 / 目标账号，保存即生效 —— BoxJs 写的键与本脚本读的键同名，
 *       都在 QX 的 $prefs 里，中间不经过任何服务器。
 * ---------------------------------------------------------------------------
 */

var CFG = {
    /* 抓到后是否弹通知（建议开，QX 通知可长按复制） */
    notify: true,
    /* 同一个 code 在多少毫秒内不重复处理/通知 */
    dedupMs: 60 * 1000,
    /* 非网关域名上，code 至少这么长才认（防止 URL 里的追踪参数误报） */
    minLen: 16,
    /* 本地保留最近多少条历史（存 $prefs） */
    historyLimit: 10,
    /* 调试日志：默认开。
     * 打开后每一步都会渲染成纯文本写进 $prefs 的 qqfarm_log_view，
     * 也就是 BoxJs 里那一栏「运行日志」，不用开任何 QX 开关。
     * 同时也会 console.log 一份，方便在 QX 设置页最下面那组（新版叫「调试记录」）里对照。 */
    debug: true,

    /* ------------------------- 自动上传到面板 -------------------------
     * enabled 打开后：抓到时先用面板账号换 token，再 POST /api/accounts
     * 把 code 写进面板并启动账号。改完保存到 QX 脚本目录即可生效。
     */
    panel: {
        enabled: false,
        /* 面板地址，别带结尾斜杠。留空表示只能在 BoxJs 里填 */
        baseUrl: '',
        /* 面板管理员账号（就是登录网页的那套） */
        username: 'admin',
        password: '',
        /* 账号备注：面板里同名账号会被当成「重新登录」覆盖旧 code，不会重复建号 */
        accountName: 'QQ农场',
        /* qq = QQ小程序，wx = 微信小程序 */
        platform: 'qq'
    },
    /* 单次上传最多等多久（毫秒）。登录 + 上传是两次串行请求，移动网络下
     * 很容易超过 4 秒；超时太短会在 $done 放行后把请求掐掉，表现就是
     * 「日志里啥也没有」。9 秒接近 QX 对单次脚本的上限。 */
    uploadWaitMs: 9000
};

var KEY_LAST = 'qqfarm_code_last';
var KEY_LAST_AT = 'qqfarm_code_last_at';
var KEY_CODE = 'qqfarm_code';
var KEY_OPENID = 'qqfarm_openid';
var KEY_VER = 'qqfarm_ver';
var KEY_HISTORY = 'qqfarm_code_history';
var KEY_TOKEN = 'qqfarm_panel_token';
var KEY_UPLOADED = 'qqfarm_uploaded_code';
var KEY_DEBUG = 'qqfarm_cfg_debug';
var KEY_LOG = 'qqfarm_dbg_log';
var KEY_LAST_ERROR = 'qqfarm_last_error';
var KEY_LAST_RESULT = 'qqfarm_last_result';
/* 下面三个是给 BoxJs 看的：订阅里 qq-farm.boxjs.json 把它们做成只读文本项，
 * 打开 BoxJs 应用就能看到结论和日志，不用去 QX 的日志页翻。 */
var KEY_STATUS = 'qqfarm_status';
var KEY_LOG_VIEW = 'qqfarm_log_view';
var KEY_TOUCH = 'qqfarm_last_touch';
var KEY_TOUCH_AT = 'qqfarm_last_touch_at';
/* 旧版：一个 JSON 存全部配置（保留兼容，优先级最低） */
var KEY_CFG = 'qqfarm_cfg';

/* BoxJs 设置页写的键（订阅文件 web/public/qqfarm.boxjs.json）。
 * BoxJs 用 $prefs.setValueForKey 落盘，键名与设置项 id 完全一致，
 * 所以这里直接读同名键即可，无需经过 BoxJs 本身。
 */
var BOX_KEYS = {
    enabled: 'qqfarm_cfg_enabled',
    baseUrl: 'qqfarm_cfg_baseUrl',
    username: 'qqfarm_cfg_username',
    password: 'qqfarm_cfg_password',
    target: 'qqfarm_cfg_target',
    accountName: 'qqfarm_cfg_accountName',
    accountId: 'qqfarm_cfg_accountId',
    platform: 'qqfarm_cfg_platform',
    notify: 'qqfarm_cfg_notify',
    debug: 'qqfarm_cfg_debug'
};

/* ----------------------------- 基础工具 ----------------------------- */

/* 日志：一条 line 同时进 QX 日志和本地环形缓冲。
 * 缓冲不依赖 QX 的日志开关，qq-farm-log.js 能随时弹出来看。 */
function pushLogLine(line) {
    var list = [];
    try {
        var raw = $prefs.valueForKey(KEY_LOG);
        if (raw) list = JSON.parse(String(raw)) || [];
        if (!(list instanceof Array)) list = [];
    } catch (e) {
        list = [];
    }
    list.unshift(line);
    if (list.length > 30) list = list.slice(0, 30);
    try {
        $prefs.setValueForKey(JSON.stringify(list), KEY_LOG);
    } catch (e) {}
    renderLogView(list);
}

/* 把「结论 + 最近日志」渲染成一段纯文本，写进 qqfarm_log_view。
 * BoxJs 订阅里这一项是 textarea（只读展示），手机上打开应用即可看到，
 * 不必再去 QX → 日志 里翻。每次写缓冲都会顺带刷新一次。 */
function renderLogView(list) {
    var lines = list;
    if (!(lines instanceof Array)) {
        lines = [];
        try {
            lines = JSON.parse(kvGet(KEY_LOG) || '[]') || [];
        } catch (e) {
            lines = [];
        }
        if (!(lines instanceof Array)) lines = [];
    }

    /* 成功/失败两串都以 "MM-DD HH:mm:ss" 开头，同一年内字典序即时间序 */
    var ok = kvGet(KEY_LAST_RESULT);
    var bad = kvGet(KEY_LAST_ERROR);
    var last = !ok ? bad : (!bad ? ok : (ok >= bad ? ok : bad));
    kvSet(KEY_STATUS, last || '还没有上传记录');

    var out = [];
    out.push('最近结果 ' + (last || '还没有上传记录'));
    out.push('最后触发 ' + (kvGet(KEY_TOUCH) || '还没被触发过'));
    out.push('-------------- 最近日志（新→旧） --------------');
    if (!lines.length) {
        out.push('（空：脚本还没抓到过任何 code）');
    } else {
        var n = lines.length > 20 ? 20 : lines.length;
        for (var i = 0; i < n; i++) out.push(lines[i]);
    }

    var text = out.join('\n');
    if (text.length > 1800) text = text.slice(0, 1800) + '\n…（已截断）';
    kvSet(KEY_LOG_VIEW, text);
}

/* 记下「脚本被触发过」。未命中时 5 秒内不重复写盘，避免网关心跳把存储写爆；
 * 命中时一定写，这样 BoxJs 里的「最后触发」永远反映最新一次真实抓取。 */
function markTouch(host, hit) {
    var now = Date.now();
    var last = parseInt(kvGet(KEY_TOUCH_AT), 10) || 0;
    if (!hit && now - last < 5000) return;
    kvSet(KEY_TOUCH_AT, now);
    kvSet(KEY_TOUCH, timeText(now) + ' ' + (host || '(无域名)') + ' 抓到=' + (hit ? '是' : '否'));
    renderLogView();
}

/* quiet=true 的日志只进 QX 日志，不写本地缓冲，避免高频未命中把缓冲刷满 */
function log(msg, quiet) {
    var line = timeText(Date.now()) + ' ' + msg;
    if (!quiet) {
        try {
            pushLogLine(line);
        } catch (e) {}
    }
    if (!CFG.debug) return;
    try {
        console.log('[QQFarm] ' + line);
    } catch (e) {}
}

function kvGet(key) {
    try {
        var v = $prefs.valueForKey(key);
        return v === null || v === undefined ? '' : String(v);
    } catch (e) {
        return '';
    }
}

function kvSet(key, value) {
    try {
        $prefs.setValueForKey(String(value), key);
    } catch (e) {}
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

function timeText(ms) {
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

/* 取 URL 主机（去掉端口），失败返回空串 */
function hostOf(url) {
    var m = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]+)/i.exec(String(url || ''));
    if (!m) return '';
    return String(m[1]).replace(/:\d+$/, '').toLowerCase();
}

/* 取 URL 查询参数（同名取第一个），失败返回空串 */
function getParam(url, name) {
    var re = new RegExp('[?&]' + name + '=([^&#\\s]*)', 'i');
    var m = re.exec(String(url || ''));
    if (!m) return '';
    var v = m[1];
    try {
        v = decodeURIComponent(v);
    } catch (e) {}
    return v;
}

/* 网关域名：*.nqf.qq.com（含裸域） */
function isGatewayHost(host) {
    if (!host) return false;
    return host === 'nqf.qq.com' || /\.nqf\.qq\.com$/.test(host);
}

/* code 合法性判断：网关域名放宽，其他域名要求长度 >= minLen */
function isValidCode(code, gateway) {
    if (!code || typeof code !== 'string') return false;
    if (code.length < 4 || code.length > 1024) return false;
    if (/^(0|1|true|false|null|undefined|none)$/i.test(code)) return false;
    /* 只接受可见 ASCII，防止把中文/换行之类的东西当 code */
    if (!/^[\x21-\x7e]+$/.test(code)) return false;
    if (gateway) return true;
    return code.length >= CFG.minLen;
}

/* 从 JSON 文本里深扫 code / openid 字段 */
function scanJson(text) {
    var out = { code: '', openID: '' };
    if (!text) return out;
    var parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        var mc = /"code"\s*:\s*"([^"\\]{4,1024})"/i.exec(text);
        if (mc) out.code = mc[1];
        var mo = /"open_?id"\s*:\s*"([^"\\]{4,128})"/i.exec(text);
        if (mo) out.openID = mo[1];
        return out;
    }
    var stack = [parsed];
    var guard = 0;
    while (stack.length > 0 && guard < 5000) {
        guard += 1;
        var cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        var keys = Object.keys(cur);
        for (var i = 0; i < keys.length; i += 1) {
            var k = keys[i];
            var v = cur[k];
            if (typeof v === 'string') {
                var lk = k.toLowerCase();
                if (!out.code && lk === 'code' && v.length >= 4 && v.length <= 1024) out.code = v;
                if (!out.openID && (lk === 'openid' || lk === 'open_id')) out.openID = v;
            } else if (v && typeof v === 'object') {
                stack.push(v);
            }
        }
    }
    return out;
}

/* ----------------------------- 历史记录 ----------------------------- */

function pushHistory(item) {
    var list = [];
    try {
        var raw = kvGet(KEY_HISTORY);
        if (raw) list = JSON.parse(raw) || [];
        if (!(list instanceof Array)) list = [];
    } catch (e) {
        list = [];
    }
    var next = [item];
    for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].code !== item.code) next.push(list[i]);
    }
    if (next.length > CFG.historyLimit) next = next.slice(0, CFG.historyLimit);
    try {
        kvSet(KEY_HISTORY, JSON.stringify(next));
    } catch (e) {}
}

/* --------------------------- 面板接口调用 --------------------------- */

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function statusOf(resp) {
    if (!resp) return 0;
    return Number(resp.statusCode || resp.status || 0) || 0;
}

/* 取生效配置：配置页写入的 qqfarm_cfg 覆盖文件里的默认值 */
/* BoxJs 保存的布尔值是字符串 "true"/"false"，这里统一宽松解析 */
function boolOf(value, dft) {
    if (value === '' || value === null || value === undefined) return dft;
    var s = String(value).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return dft;
}

/* 配置来源优先级：BoxJs 设置页 > 旧版 qqfarm_cfg JSON > 本文件 CFG.panel 默认值 */
function loadPanelCfg() {
    var p = {
        enabled: CFG.panel.enabled === true,
        baseUrl: CFG.panel.baseUrl,
        username: CFG.panel.username,
        password: CFG.panel.password,
        mode: 'name',
        accountId: '',
        accountName: CFG.panel.accountName,
        platform: CFG.panel.platform || 'qq',
        notify: CFG.notify !== false
    };

    var stored = parseJson(kvGet(KEY_CFG));
    if (stored && typeof stored === 'object') {
        var keys = Object.keys(p);
        for (var i = 0; i < keys.length; i += 1) {
            var k = keys[i];
            if (stored[k] !== undefined && stored[k] !== null && stored[k] !== '') p[k] = stored[k];
        }
        p.enabled = stored.enabled === true || stored.enabled === 'true';
        if (stored.accountName) p.accountName = stored.accountName;
    }

    /* BoxJs 设置页：只覆盖用户真正填过的项（空值表示没填，保留上一级的值） */
    var boxEnabled = kvGet(BOX_KEYS.enabled);
    if (boxEnabled !== '') p.enabled = boolOf(boxEnabled, p.enabled);
    var boxNotify = kvGet(BOX_KEYS.notify);
    if (boxNotify !== '') p.notify = boolOf(boxNotify, p.notify);
    var boxBaseUrl = kvGet(BOX_KEYS.baseUrl);
    if (boxBaseUrl !== '') p.baseUrl = boxBaseUrl.replace(/\/+$/, '');
    var boxUser = kvGet(BOX_KEYS.username);
    if (boxUser !== '') p.username = boxUser;
    var boxPass = kvGet(BOX_KEYS.password);
    if (boxPass !== '') p.password = boxPass;
    var boxName = kvGet(BOX_KEYS.accountName);
    if (boxName !== '') p.accountName = boxName;
    var boxId = kvGet(BOX_KEYS.accountId);
    if (boxId !== '') p.accountId = boxId;
    var boxPlatform = kvGet(BOX_KEYS.platform);
    if (boxPlatform !== '') p.platform = boxPlatform;
    var boxTarget = kvGet(BOX_KEYS.target);
    if (boxTarget !== '') p.mode = boxTarget === 'account' ? 'account' : 'name';
    var boxDebug = kvGet(BOX_KEYS.debug);
    if (boxDebug !== '') CFG.debug = boolOf(boxDebug, CFG.debug);

    /* 「指定账号」必须真有 id，否则退回按备注名，避免提交一个空 id 被服务端当新增 */
    if (p.mode === 'account' && !p.accountId) p.mode = 'name';

    /* 通知开关同样作用于上传结果提示 */
    CFG.notify = p.notify !== false;
    return p;
}

/* 配置快照，日志里只露密码长度，不落明文 */
function describePanel(p) {
    var pwd = p.password ? ('已填(' + p.password.length + '位)') : '未填';
    var tk = kvGet(KEY_TOKEN) ? '有缓存' : '无';
    return 'enabled=' + (p.enabled ? 'on' : 'off') +
        ' baseUrl=' + (p.baseUrl || '(空)') +
        ' user=' + (p.username || '(空)') +
        ' pass=' + pwd + ' token=' + tk +
        ' mode=' + p.mode + (p.accountId ? '/' + p.accountId : '') +
        ' name=' + (p.accountName || '(空)') +
        ' platform=' + p.platform + ' notify=' + (p.notify ? 'on' : 'off');
}

function apiRequest(baseUrl, path, payload, token) {
    var base = String(baseUrl || '').replace(/\/+$/, '');
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-admin-token'] = token;
    var opts = {
        url: base + path,
        method: 'POST',
        headers: headers,
        timeout: CFG.uploadWaitMs
    };
    if (payload) opts.body = JSON.stringify(payload);
    return $task.fetch(opts);
}

/* 登录换 token。面板 token 存在内存里，服务一重启就失效，所以按需登录。 */
function loginPanel(panel) {
    if (!panel.password) {
        throw new Error('未配置面板密码');
    }
    var started = Date.now();
    log('登录 → POST ' + panel.baseUrl + '/api/login user=' + panel.username);
    return apiRequest(panel.baseUrl, '/api/login', {
        username: panel.username,
        password: panel.password
    }).then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        var cost = Date.now() - started;
        if (status === 200 && body && body.ok && body.data && body.data.token) {
            kvSet(KEY_TOKEN, body.data.token);
            log('登录成功 ' + status + ' ' + cost + 'ms token=' + String(body.data.token).slice(0, 8) + '…');
            return body.data.token;
        }
        /* 面板对同 IP 有节流：每分钟 10 次，连续失败 5 次锁 15 分钟 */
        var msg = (body && body.error) || ('HTTP ' + status);
        if (status === 423) msg = 'IP 被锁，稍后再试（' + msg + '）';
        if (status === 429) msg = '请求太频繁（' + msg + '）';
        if (status === 0) msg = '连不上面板，检查地址/端口/手机网络';
        log('登录失败 ' + status + ' ' + cost + 'ms msg=' + msg);
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 登录失败: ' + msg + ' (HTTP ' + status + ')');
        throw new Error('登录失败: ' + msg);
    });
}

/* 把 code 写进面板。
 * - 按备注名：同名走「重新登录」，覆盖旧 code 并重启该账号
 * - 指定账号：带 id 走更新分支，直接写回那个账号（name 仍必填，取面板返回的名称）
 */
function addAccount(panel, code, openID, token) {
    var payload = {
        name: panel.accountName || 'QQ农场',
        platform: panel.platform || 'qq',
        code: code,
        /* 与网页手动填 Code 走同一条路径 */
        loginType: 'manual'
    };
    if (panel.mode === 'account' && panel.accountId) payload.id = String(panel.accountId);
    /* 服务端只认小写 openid（core/src/models/store/accounts.ts 的字段白名单） */
    if (openID) payload.openid = openID;
    var started = Date.now();
    log('上传 → POST ' + panel.baseUrl + '/api/accounts name=' + payload.name +
        (payload.id ? ' id=' + payload.id : '') +
        ' code=' + String(code).slice(0, 8) + '…' + (openID ? ' openid=' + String(openID).slice(-6) : ''));
    return apiRequest(panel.baseUrl, '/api/accounts', payload, token).then(function (resp) {
        var status = statusOf(resp);
        var body = parseJson(resp && resp.body);
        var cost = Date.now() - started;
        log('上传响应 ' + status + ' ' + cost + 'ms body=' + String((resp && resp.body) || '').slice(0, 200));
        return { status: status, body: body };
    });
}

function notifyUploadOk(panel, code) {
    if (!CFG.notify) return;
    try {
        $notify('QQ农场 Code 已上传', (panel.accountName || 'QQ农场') + ' · 面板已开始登录', code);
    } catch (e) {}
}

function notifyUploadFail(code, reason) {
    if (!CFG.notify) return;
    try {
        $notify('QQ农场 上传失败', String(reason || '未知原因').slice(0, 60) + ' · 可手动复制', code);
    } catch (e) {}
}

/* 自检通道：Safari 打开带 code=QXTEST 的网关地址时走这里（不上传）。
 * 作用是把「脚本有没有在跑 / 配置读到没 / 缓冲里有什么」直接用通知弹出来，
 * 不依赖 BoxJs 是否渲染那一栏，也不依赖 QX 的日志开关。
 * 弹不出来 = 脚本压根没被触发（重写没启用 / MITM 没开 / 证书没信任）。 */
function selfTestReport(code, host) {
    var lines = [];
    try {
        var raw = $prefs.valueForKey(KEY_LOG);
        if (raw) lines = JSON.parse(String(raw)) || [];
    } catch (e) {
        lines = [];
    }
    if (!(lines instanceof Array)) lines = [];

    var panel = loadPanelCfg();
    var cfgLine = 'enabled=' + (panel.enabled ? 'on' : 'off') +
        '\nbaseUrl=' + (panel.baseUrl || '未填') +
        '\nuser=' + (panel.username || '未填') +
        '\npass=' + (panel.password ? '已填(' + panel.password.length + '位)' : '未填') +
        '\nmode=' + panel.mode + ' name=' + (panel.accountName || '未填');

    try {
        $notify('QQ农场 自检 · 脚本在跑',
            '命中 ' + (host || '(无域名)') + ' · 缓冲 ' + lines.length + ' 条',
            '配置快照：\n' + cfgLine);
    } catch (e) {}

    var body = lines.length
        ? lines.slice(0, 5).join('\n')
        : '缓冲是空的：脚本能跑，但还没抓到过 code';
    try {
        $notify('QQ农场 自检 · 最近日志',
            lines.length + ' 条（新→旧，最多显示 5 条）',
            body);
    } catch (e) {}

    log('自检触发 host=' + (host || '(无)') + ' 缓冲=' + lines.length + ' 条');
}

function upload(code, openID) {
    var panel = loadPanelCfg();
    log('配置 ' + describePanel(panel));
    if (!panel.enabled) {
        log('自动上传未开启（qqfarm_cfg_enabled），只通知');
        return null;
    }
    /* 同一条 code 只上传一次，QX 重启/重连也不会重复推 */
    if (kvGet(KEY_UPLOADED) === code) {
        log('该 code 已上传过，跳过');
        return null;
    }
    if (!panel.baseUrl) {
        log('中止：未配置面板地址');
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 未配置面板地址');
        notifyUploadFail(code, '未配置面板地址');
        return null;
    }
    if (!panel.password && !kvGet(KEY_TOKEN)) {
        log('中止：未配置面板密码');
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 未配置面板密码');
        notifyUploadFail(code, '未配置面板密码');
        return null;
    }

    var token = kvGet(KEY_TOKEN);
    log(token ? '复用缓存 token' : '无缓存 token，先登录');
    var first = token ? addAccount(panel, code, openID, token)
        : loginPanel(panel).then(function (t) { return addAccount(panel, code, openID, t); });

    return first.then(function (res) {
        /* token 过期（服务重启/改密清空）时自动重登一次再试 */
        if (res && res.status === 401) {
            log('token 失效(401)，重新登录后重试');
            return loginPanel(panel).then(function (t) { return addAccount(panel, code, openID, t); });
        }
        return res;
    }).then(function (res) {
        if (res && res.body && res.body.ok) {
            kvSet(KEY_UPLOADED, code);
            kvSet(KEY_LAST_RESULT, timeText(Date.now()) + ' 上传成功 HTTP ' + res.status + ' · ' + panel.accountName);
            log('上传成功，已记录');
            notifyUploadOk(panel, code);
            return res;
        }
        var reason = (res && res.body && (res.body.error || res.body.message)) || ('HTTP ' + (res ? res.status : 0));
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 上传失败: ' + reason + ' (HTTP ' + (res ? res.status : 0) + ')');
        log('上传失败: ' + reason);
        notifyUploadFail(code, reason);
        return res;
    }, function (err) {
        var reason = String((err && err.message) || err || '网络异常');
        kvSet(KEY_LAST_ERROR, timeText(Date.now()) + ' 上传异常: ' + reason);
        log('上传异常: ' + reason);
        notifyUploadFail(code, reason);
        return null;
    });
}

/* ----------------------------- 主流程 ----------------------------- */

function main() {
    var url = '';
    var reqBody = '';
    var respBody = '';
    var hasResponse = (typeof $response !== 'undefined') && !!$response;

    if (typeof $request !== 'undefined' && $request) {
        url = String($request.url || '');
        if ($request.body) reqBody = String($request.body);
    }
    if (hasResponse) {
        if (!url) url = String($response.url || '');
        if ($response.body) respBody = String($response.body);
    }

    var host = hostOf(url);
    var gateway = isGatewayHost(host);
    var code = getParam(url, 'code');
    var openID = getParam(url, 'openID') || getParam(url, 'openid') || '';
    var ver = getParam(url, 'ver') || getParam(url, 'version') || '';

    /* 每次触发都留一行：没抓到的时候，靠这行判断「脚本到底有没有跑」 */
    log('触发 ' + (hasResponse ? 'response' : 'request') +
        ' host=' + (host || '(无)') + ' gateway=' + gateway +
        ' 参数code=' + (code ? '有' : '无'), true);

    if (!code && reqBody) {
        var fromReq = scanJson(reqBody);
        if (fromReq.code) {
            code = fromReq.code;
            if (!openID) openID = fromReq.openID;
        }
    }
    if (!code && respBody) {
        var fromResp = scanJson(respBody);
        if (fromResp.code) {
            code = fromResp.code;
            if (!openID) openID = fromResp.openID;
        }
    }

    /* 自检优先于一切校验：Safari 打开
     * https://gate-obt.nqf.qq.com/prod/ws?platform=qq&ver=1.0.0_20260101&code=QXTEST-0000-1111-2222
     * 就会弹两条通知，把脚本状态和日志直接给你，不上传、不改动任何存储里的配置。 */
    if (code && code.indexOf('QXTEST') === 0) {
        selfTestReport(code, host);
        return null;
    }

    if (!isValidCode(code, gateway)) {
        markTouch(host, false);
        log('未命中 host=' + (host || '(无)') + ' gateway=' + gateway +
            ' code=' + (code ? code.slice(0, 8) + '…' : '(空)'), true);
        return null;
    }
    markTouch(host, true);

    var now = Date.now();
    var lastCode = kvGet(KEY_LAST);
    var lastAt = parseInt(kvGet(KEY_LAST_AT), 10) || 0;
    var isDup = (code === lastCode) && (now - lastAt < CFG.dedupMs);

    kvSet(KEY_CODE, code);
    kvSet(KEY_LAST, code);
    kvSet(KEY_LAST_AT, now);
    if (openID) kvSet(KEY_OPENID, openID);
    if (ver) kvSet(KEY_VER, ver);

    if (isDup) {
        log('重复 code（' + Math.round((now - lastAt) / 1000) + 's 内），只更新落盘', true);
        return null;
    }

    pushHistory({ code: code, openID: openID, ver: ver, host: host, at: now });
    log('抓到 code=' + code.slice(0, 8) + '… len=' + code.length +
        (openID ? ' openid=' + openID.slice(-6) : '') + (ver ? ' ver=' + ver : '') + ' host=' + host);

    /* 开了自动上传就只发一条「已上传/失败」通知；没开才发「已捕获」 */
    if (!loadPanelCfg().enabled && CFG.notify) {
        var sub = timeText(now) + ' · 长按可复制';
        if (host) sub = host + ' · ' + sub;
        try {
            $notify('QQ农场 Code 已捕获', sub, code);
        } catch (e) {}
    }

    return upload(code, openID);
}

var startedAt = Date.now();
var pending = main();

/* 收尾：请求/响应原样放行，绝不改写。
 * 上传是异步的，所以加一个超时兜底，面板不通时最多等 uploadWaitMs 就放行，
 * 避免把 QQ 的 WebSocket 握手拖到超时。 */
var finished = false;

function finish() {
    if (finished) return;
    finished = true;
    log('放行请求，本次耗时 ' + (Date.now() - startedAt) + 'ms', true);
    try {
        $done({});
    } catch (e) {}
}

if (pending && typeof pending.then === 'function') {
    pending.then(finish, function (e) {
        log('收尾异常: ' + e);
        finish();
    });
    try {
        if (typeof setTimeout === 'function') setTimeout(finish, CFG.uploadWaitMs);
    } catch (e) {}
} else {
    finish();
}
