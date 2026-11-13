/**
 * QQ经典农场 · 回看最近抓到的 Code（Quantumult X）
 * ---------------------------------------------------------------------------
 * 用途：通知一闪而过没复制到、或者想翻一下刚抓的几条，跑这个脚本重新弹一次。
 * 类型：task（定时/手动触发皆可），与 qq-farm-code.js 共用同一份 $prefs 存储。
 *
 * 配置示例（[task_local]，默认关闭，需要时手动开）：
 *   0 9 * * * qq-farm-code-show.js, tag=QQ农场Code回看, enabled=false
 *
 * 也可以配合「QX → 定时任务 → 立即运行」触发，不必等 cron。
 * ---------------------------------------------------------------------------
 */

var KEY_CODE = 'qqfarm_code';
var KEY_AT = 'qqfarm_code_at';
var KEY_LAST_AT = 'qqfarm_code_last_at';
var KEY_OPENID = 'qqfarm_openid';
var KEY_HISTORY = 'qqfarm_code_history';
var SHOW_HISTORY = 3;

function kvGet(k) {
    try {
        var v = $prefs.valueForKey(k);
        return v === null || v === undefined ? '' : String(v);
    } catch (e) {
        return '';
    }
}

function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}

function timeText(ms) {
    if (!ms) return '时间未知';
    var d = new Date(ms);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}

var code = kvGet(KEY_CODE);
if (!code) {
    $notify('QQ农场 Code', '还没有抓到过', '先在手机 QQ 里打开一次「QQ经典农场」');
    $done();
} else {
    var at = parseInt(kvGet(KEY_LAST_AT) || kvGet(KEY_AT), 10) || 0;
    var openID = kvGet(KEY_OPENID);
    var sub = timeText(at) + (openID ? ' · openID ' + openID.slice(-6) : '');
    $notify('QQ农场 Code（最近一条）', sub, code);

    /* 附带再弹几条历史，方便挑一条还有效的 */
    var list = [];
    try {
        list = JSON.parse(kvGet(KEY_HISTORY) || '[]') || [];
    } catch (e) {
        list = [];
    }
    var shown = 0;
    for (var i = 0; i < list.length && shown < SHOW_HISTORY; i += 1) {
        var it = list[i];
        if (!it || !it.code || it.code === code) continue;
        $notify('QQ农场 Code（历史 ' + (shown + 1) + '）', timeText(it.at), it.code);
        shown += 1;
    }
    $done();
}
