/**
 * QQ经典农场 · 抓码诊断（Quantumult X）
 * ---------------------------------------------------------------------------
 * 用途：抓不到 / 上传没反应的时候跑一次，把「当前配置 + 面板连通性 +
 *       最近一次上传结果 + 最近日志」全弹出来，不用抓包、不用连电脑。
 *
 * 类型：task（定时/手动触发皆可），与 qq-farm-code.js 共用同一份 $prefs 存储。
 *
 * 跑法一（推荐）：QX → 定时任务 → 找到「QQ农场 诊断」→ 立即运行
 * 跑法二：加到 [task_local]，手动点一下
 *   0 9 * * * qq-farm-check.js, tag=QQ农场诊断, enabled=false
 *
 * 输出是几条通知，标题以「QQ农场诊断」开头，从 1 开始编号。
 * ---------------------------------------------------------------------------
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
var KEY_LOG = 'qqfarm_dbg_log';
var KEY_LAST_ERROR = 'qqfarm_last_error';
var KEY_LAST_RESULT = 'qqfarm_last_result';
var KEY_TOKEN = 'qqfarm_panel_token';
var KEY_CODE = 'qqfarm_code';
var KEY_LAST_AT = 'qqfarm_code_last_at';
/* 与订阅里的 textarea 同名，诊断结论会写进去，BoxJs 里直接能看 */
var KEY_LOG_VIEW = 'qqfarm_log_view';
var KEY_TOUCH = 'qqfarm_last_touch';
var SHOW_LOG = 8;

function kvSet(k, v) {
    try {
        $prefs.setValueForKey(String(v), k);
    } catch (e) {}
}

function readLogLines() {
    var lines = [];
    try {
        lines = JSON.parse(kvGet(KEY_LOG) || '[]') || [];
    } catch (e) {
        lines = [];
    }
    if (!(lines instanceof Array)) lines = [];
    return lines;
}

/* 把诊断结论 + 最近日志写回 BoxJs 的只读日志项 */
function writeBoxView(verdict) {
    var ok = kvGet(KEY_LAST_RESULT);
    var bad = kvGet(KEY_LAST_ERROR);
    var last = !ok ? bad : (!bad ? ok : (ok >= bad ? ok : bad));
    var lines = readLogLines();

    var out = [];
    out.push('【诊断 ' + timeText(Date.now()) + '】' + verdict);
    out.push('最近结果 ' + (last || '还没有上传记录'));
    out.push('最后触发 ' + (kvGet(KEY_TOUCH) || '还没被触发过'));
    out.push('-------------- 最近日志（新→旧） --------------');
    if (!lines.length) {
        out.push('（空：qq-farm-code.js 一次都没跑到，先查重写/MITM/证书）');
    } else {
        var n = lines.length > 20 ? 20 : lines.length;
        for (var i = 0; i < n; i++) out.push(lines[i]);
    }
    var text = out.join('\n');
    if (text.length > 1800) text = text.slice(0, 1800) + '\n…（已截断）';
    kvSet(KEY_LOG_VIEW, text);
}

function kvGet(k) {
    try {
        var v = $prefs.valueForKey(k);
        return v === null || v === undefined ? '' : String(v);
    } catch (e) {
        return '';
    }
}

function boolOf(v) {
    if (v === '' || v === null || v === undefined) return false;
    var s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

function timeText(ms) {
    if (!ms) return '未知';
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

var seq = 0;
function notify(title, sub, body) {
    seq += 1;
    try {
        $notify('QQ农场诊断 ' + seq + ' · ' + title, sub || '', body || '');
    } catch (e) {}
}

/* ---------------------------- 1. 配置快照 ---------------------------- */

var cfg = {
    enabled: boolOf(kvGet(BOX_KEYS.enabled)),
    baseUrl: kvGet(BOX_KEYS.baseUrl).replace(/\/+$/, ''),
    username: kvGet(BOX_KEYS.username),
    password: kvGet(BOX_KEYS.password),
    target: kvGet(BOX_KEYS.target) || 'name',
    accountName: kvGet(BOX_KEYS.accountName),
    accountId: kvGet(BOX_KEYS.accountId),
    platform: kvGet(BOX_KEYS.platform) || 'qq',
    notify: kvGet(BOX_KEYS.notify),
    debug: kvGet(BOX_KEYS.debug)
};

var lastCode = kvGet(KEY_CODE);
var lastAt = parseInt(kvGet(KEY_LAST_AT), 10) || 0;

var pwdDesc;
if (!cfg.password) {
    pwdDesc = '未填 ✗';
} else if (/^\s|\s$/.test(cfg.password)) {
    pwdDesc = '已填 ' + cfg.password.length + ' 位（前后有空格！）';
} else {
    pwdDesc = '已填 ' + cfg.password.length + ' 位';
}

notify('配置',
    '自动上传 ' + (cfg.enabled ? '开' : '关 ✗') + ' · 地址 ' + (cfg.baseUrl || '空 ✗'),
    '面板地址：' + (cfg.baseUrl || '(空)') + '\n' +
    '管理员：' + (cfg.username || '(空)') + '\n' +
    '密码：' + pwdDesc + '\n' +
    '上传到：' + cfg.target + ' / ' + (cfg.target === 'account' ? (cfg.accountId || '(无 id)') : (cfg.accountName || '(空)')) + '\n' +
    '平台：' + cfg.platform + ' · 通知 ' + (cfg.notify === 'false' ? '关' : '开') + ' · 调试 ' + (cfg.debug === 'false' ? '关' : '开') + '\n' +
    '最近 code：' + (lastCode ? lastCode.slice(0, 10) + '… @' + timeText(lastAt) : '还没抓到过')
);

/* ------------------------ 2. 面板登录连通性自检 ------------------------ */

function done() {
    try {
        $done();
    } catch (e) {}
}

if (!cfg.baseUrl) {
    notify('登录自检', '跳过：没填面板地址', '先去 BoxJs 填 http://你的服务器IP:3007');
    writeBoxView('未自检（没填面板地址）· 自动上传 ' + (cfg.enabled ? '开' : '关'));
    done();
} else if (!cfg.password) {
    notify('登录自检', '跳过：没填密码', 'BoxJs 里「管理员密码」是空的，脚本无法登录换 token');
    writeBoxView('未自检（没填面板密码）· 自动上传 ' + (cfg.enabled ? '开' : '关'));
    done();
} else {
    var started = Date.now();
    var opts = {
        url: cfg.baseUrl + '/api/login',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cfg.username, password: cfg.password }),
        timeout: 12000
    };
    $task.fetch(opts).then(function (resp) {
        var status = Number(resp.statusCode || 0) || 0;
        var cost = Date.now() - started;
        var body = null;
        try {
            body = JSON.parse(resp.body);
        } catch (e) {
            body = null;
        }
        if (status === 200 && body && body.ok && body.data && body.data.token) {
            notify('登录自检 · 通过',
                'HTTP 200 · ' + cost + 'ms',
                '面板地址、账号、密码都对，token 已拿到。\n' +
                '如果抓包还是不灵，问题在 QX 重写/MITM 那一侧，或者根本没触发到网关域名。');
            showTail('登录自检通过 HTTP 200 · ' + cost + 'ms · 自动上传 ' + (cfg.enabled ? '开' : '关'));
        } else {
            var msg = (body && body.error) || ('HTTP ' + status);
            var hint;
            if (status === 401) hint = '账号或密码不对（注意首尾空格）。连续错 5 次会锁 15 分钟。';
            else if (status === 423) hint = '这个手机出口 IP 被面板锁了，等 15 分钟再试。';
            else if (status === 429) hint = '请求太频繁，面板每分钟只允许 10 次。';
            else if (status === 0) hint = '连不上面板。检查地址端口、手机网络，以及服务是否在跑。';
            else hint = '看 body 里的 error 字段。';
            notify('登录自检 · 失败',
                'HTTP ' + status + ' · ' + cost + 'ms',
                msg + '\n\n' + hint);
            showTail('登录自检失败 HTTP ' + status + ' · ' + msg);
        }
    }, function (err) {
        var reason = String((err && err.message) || err);
        notify('登录自检 · 异常',
            '网络层就挂了',
            reason + '\n\n' +
            '连不上 ' + cfg.baseUrl + '。先用手机浏览器打开这个地址看能不能出登录页。');
        showTail('登录自检异常 · ' + reason);
    });
}

/* ----------------------- 3. 最近结果 / 错误 / 日志 ----------------------- */

function showTail(verdict) {
    var result = kvGet(KEY_LAST_RESULT);
    var error = kvGet(KEY_LAST_ERROR);
    notify('上次结果',
        result ? '有一次成功记录' : (error ? '最近是失败' : '还没有上传记录'),
        '成功：' + (result || '无') + '\n' +
        '失败：' + (error || '无')
    );

    var lines = readLogLines();

    if (lines.length === 0) {
        notify('最近日志', '缓冲是空的',
            '说明 qq-farm-code.js 一次都没跑到，或者跑的是旧版本。\n' +
            '先确认：① 远程重写已启用 ② MITM 已开且证书已信任 ③ 脚本地址能下载到新版。');
    } else {
        var head = lines.slice(0, SHOW_LOG).join('\n');
        notify('最近日志 ' + Math.min(SHOW_LOG, lines.length) + ' 条',
            '共 ' + lines.length + ' 条 · 新→旧',
            head + '\n\n（QX 日志页能看到全部，含被截断的长行）');
    }

    /* 结论同时落到 BoxJs 的只读日志项，回头打开应用就能复查 */
    writeBoxView(verdict || '已执行');
    done();
}
