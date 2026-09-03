/**
 * 微博超话 · Quantumult X 请求抓取
 *
 * 仅用于抓取微博 APP 的关注超话列表请求和超话签到请求。
 * 由于 Quantumult X 对 script-request-header/body 脚本要求使用本地文件，
 * 请把本文件放到 Quantumult X 的 Scripts 目录，再在 rewrite_local 中引用文件名。
 */

const $ = new Env("微博超话");

const KEY_LIST_URL = 'evil_tokenurl';
const KEY_LIST_HEADERS = 'evil_tokenheaders';
const KEY_LIST_BODY = 'evil_tokenbody';
const KEY_LIST_METHOD = 'evil_tokenmethod';
const KEY_CHECKIN_URL = 'evil_tokencheckinurl';
const KEY_CHECKIN_HEADERS = 'evil_tokencheckinheaders';
const KEY_CHECKIN_BODY = 'evil_tokencheckinbody';
const KEY_CHECKIN_METHOD = 'evil_tokencheckinmethod';

main();

function main() {
    if (typeof $request === 'undefined' || !$request) {
        $.log('[ERROR] 该脚本仅作为请求重写脚本运行');
        $.done();
        return;
    }

    const method = String($request.method || '').toUpperCase();
    if (method === 'OPTIONS') {
        $.done();
        return;
    }

    const url = String($request.url || '');
    const decodedUrl = decodeUrl(url);

    if (isNewListRequest(url) || isLegacyListRequest(decodedUrl)) {
        captureList(url, method);
        return;
    }

    if (isCheckinRequest(url, decodedUrl)) {
        captureCheckin(url, method);
        return;
    }

    $.done();
}

function isNewListRequest(url) {
    return /\/2\/statuses\/container_timeline_topic(?:sub|page)(?:[/?]|$)/i.test(url);
}

function isLegacyListRequest(url) {
    if (!/\/2\/cardlist(?:[/?]|$)/i.test(url)) return false;
    return /(?:myfollow|followsuper|need[_-]head[_-]cards|super(?:topic)?)/i.test(url);
}

function isCheckinRequest(url, decodedUrl) {
    if (!/\/2\/page\/button(?:[/?]|$)/i.test(url)) return false;
    // active_checkin 有时位于 request_url 的 URL 编码参数中，需同时检查解码前后文本。
    return /active[_-]checkin/i.test(url) || /active[_-]checkin/i.test(decodedUrl);
}

function captureList(url, method) {
    try {
        let body = String($request.body || '');
        if (!body || body.length < 10) {
            body = defaultListBody();
            $.log('[INFO] 列表请求没有 body，使用兼容默认参数');
        }

        // 首次请求优先保存第一页；避免翻页请求覆盖掉第一页的模板。
        const oldUrl = $.getdata(KEY_LIST_URL) || '';
        const initial = !hasPageCursor(url, body) || /taskType=refresh/i.test(body);
        if (!oldUrl || initial) {
            save(KEY_LIST_URL, url);
            save(KEY_LIST_HEADERS, JSON.stringify($request.headers || {}));
            save(KEY_LIST_BODY, body);
            save(KEY_LIST_METHOD, method || 'POST');
            $.log(`[INFO] 已保存列表请求: ${method || 'UNKNOWN'} url=${url.length} body=${body.length}`);
        } else {
            $.log('[INFO] 忽略列表翻页请求，保留第一页请求模板');
        }

        const checkinExists = !!$.getdata(KEY_CHECKIN_URL);
        $.msg(
            '微博超话',
            '✅ 已捕获关注列表请求',
            checkinExists
                ? '✨ 列表 + 签到请求都已就绪，可以关闭重写'
                : '🔍 接下来进入任意超话，手动签到一次'
        );
    } catch (e) {
        $.log('[ERROR] 列表请求保存失败: ' + (e.message || e));
        $.msg('微博超话', '🚫 列表请求保存失败', String(e.message || e));
    }
    $.done();
}

function captureCheckin(url, method) {
    try {
        const headers = $request.headers || {};
        const headerText = Object.keys(headers).join(',');
        const hasValidator = /(?:^|,)(?:x-validator|x[_-]validator)(?:,|$)/i.test(headerText);

        // 只保存 active_checkin，防止进入超话时的其它 page/button 请求覆盖有效模板。
        save(KEY_CHECKIN_URL, url);
        save(KEY_CHECKIN_HEADERS, JSON.stringify(headers));
        save(KEY_CHECKIN_BODY, String($request.body || ''));
        save(KEY_CHECKIN_METHOD, method || 'GET');
        $.log(`[INFO] 已保存签到请求: ${method || 'UNKNOWN'} url=${url.length} X-Validator=${hasValidator ? '有' : '无'}`);

        const listExists = !!$.getdata(KEY_LIST_URL);
        const hint = hasValidator ? '' : '\n⚠️ 本次请求未见 X-Validator，若签到失败请在未关闭重写时重新手动签到。';
        $.msg(
            '微博超话',
            '🎉 已捕获超话签到请求',
            (listExists
                ? '✨ 列表 + 签到请求都已就绪，可以关闭重写'
                : '⚠️ 还需要先进入“我的 → 超话社区 → 我的 → 关注”') + hint
        );
    } catch (e) {
        $.log('[ERROR] 签到请求保存失败: ' + (e.message || e));
        $.msg('微博超话', '🚫 签到请求保存失败', String(e.message || e));
    }
    $.done();
}

function hasPageCursor(url, body) {
    return /(?:[?&]|%26)since_id(?:=|%3D)/i.test(url) || /(?:^|&)since_id=/i.test(body);
}

function defaultListBody() {
    return 'filterGroupStyle=1&flowId=232478_-_mine_topic&flowVersion=0.0.1&lfid=profile_me&luicode=10000011&mix_media_enable=1&moduleID=pagecard&orifid=profile_me&oriuicode=10000011&pageDataType=flow&sg_tab_config=2&source_code=10000011_profile_me&taskType=refresh&uicode=10001387';
}

function save(key, value) {
    if (!$.setdata(String(value), key)) {
        $.log(`[WARN] 本地数据写入失败: ${key}`);
    }
}

function decodeUrl(value) {
    let result = String(value || '');
    for (let i = 0; i < 2; i++) {
        try {
            const next = decodeURIComponent(result);
            if (next === result) break;
            result = next;
        } catch (_) {
            break;
        }
    }
    return result;
}

function Env(s) {
    this.name = s;
    this.isSurge = () => typeof $httpClient !== 'undefined';
    this.isQuanX = () => typeof $task !== 'undefined';
    this.isLoon = () => typeof $loon !== 'undefined';
    this.log = (...a) => console.log(a.join('\n'));
    this.msg = (t = this.name, s = '', b = '') => {
        if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
        else if (this.isQuanX()) $notify(t, s, b);
        console.log(['', '====📣' + t + '====', s, b].filter(Boolean).join('\n'));
    };
    this.getdata = (k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.read(k);
        if (this.isQuanX()) return $prefs.valueForKey(k);
        return null;
    };
    this.setdata = (v, k) => {
        if (this.isSurge() || this.isLoon()) return $persistentStore.write(v, k);
        if (this.isQuanX()) return $prefs.setValueForKey(v, k);
        return false;
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}
