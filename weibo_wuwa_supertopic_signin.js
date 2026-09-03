/**
 * 微博超话 · 微博 APP「超话」每日签到所有关注超话
 *
 * 双模式脚本：请求重写时抓取微博 App 请求；定时运行时自动签到。
 * 抓取①:打开微博 APP → 我的 → 超话社区 → 我的 → 关注
 * 抓取②:在超话页手动签到一次
 *
 * @Author: @Evilbutcher (https://github.com/evilbutcher) / @toulanboy (https://github.com/toulanboy/scripts)
 * @Modifier: MaYIHEI <https://github.com/MaYIHEI/paperclip>
 * @Channel: Telegram 频道 https://t.me/mayihei
 * @Updated: 2026-09-03
 *
 * ===== Loon =====
 * [MITM]
 * hostname = api.weibo.cn
 * [Script]
 * http-request ^https:\/\/api\.weibo\.cn\/2\/(statuses\/container_timeline_topicsub|cardlist|page\/button) tag=微博超话 Cookie, script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js, requires-body=true, img-url=https://raw.githubusercontent.com/MaYIHEI/pin/refs/heads/main/app/weibo.png
 * cron "0 8 * * *" script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js, tag=微博超话签到, img-url=https://raw.githubusercontent.com/MaYIHEI/pin/refs/heads/main/app/weibo.png, enable=true
 *
 * ===== Surge =====
 * [MITM]
 * hostname = api.weibo.cn
 * [Script]
 * 微博超话 Cookie = type=http-request,pattern=^https:\/\/api\.weibo\.cn\/2\/(statuses\/container_timeline_topicsub|cardlist|page\/button),requires-body=true,max-size=0,script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js,img-url=https://raw.githubusercontent.com/MaYIHEI/pin/refs/heads/main/app/weibo.png
 * 微博超话签到 = type=cron,cronexp=0 8 * * *,timeout=60,script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js,img-url=https://raw.githubusercontent.com/MaYIHEI/pin/refs/heads/main/app/weibo.png
 *
 * ===== Quantumult X =====
 * [MITM]
 * hostname = api.weibo.cn, mapi.weibo.com
 * [rewrite_local]
 * ^https?:\/\/m?api\.weibo\.c(n|om)\/2\/statuses\/container_timeline_topic(?:sub|page)(?:[\/?].*)?$ url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js
 * ^https?:\/\/m?api\.weibo\.c(n|om)\/2\/cardlist url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js
 * ^https?:\/\/m?api\.weibo\.c(n|om)\/2\/page\/button.*active(?:_|%5f)checkin url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js
 * [task_local]
 * 0 8 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js, tag=微博超话签到, img-url=https://raw.githubusercontent.com/MaYIHEI/pin/refs/heads/main/app/weibo.png, enabled=true
 *
 * ===== Stash =====
 * cron:
 *   script:
 *     - name: 微博超话签到
 *       cron: '0 8 * * *'
 *       timeout: 60
 * http:
 *   mitm:
 *     - "api.weibo.cn"
 *   script:
 *     - match: ^https:\/\/api\.weibo\.cn\/2\/(statuses\/container_timeline_topicsub|page\/button)
 *       name: 微博超话 Cookie
 *       type: request
 *       require-body: true
 * script-providers:
 *   微博超话签到:
 *     url: https://raw.githubusercontent.com/d539834401/QxSignUp/main/weibo_wuwa_supertopic_signin.js
 *     interval: 86400
 */

const $ = new Env("微博超话");

const SCRIPT_VERSION = "2026-09-03.r7";
if (typeof $request === "undefined") $.log(`[INFO] 脚本版本 ${SCRIPT_VERSION}`);

$.delete_cookie = false;
$.msg_max_num = 30;
$.req_interval = 700;
$.debug = false;

const KEY_LIST_URL = 'evil_tokenurl';
const KEY_LIST_HEADERS = 'evil_tokenheaders';
const KEY_LIST_BODY = 'evil_tokenbody';
const KEY_LIST_METHOD = 'evil_tokenmethod';
const KEY_CHECKIN_URL = 'evil_tokencheckinurl';
const KEY_CHECKIN_HEADERS = 'evil_tokencheckinheaders';
const KEY_CHECKIN_BODY = 'evil_tokencheckinbody';
const KEY_CHECKIN_METHOD = 'evil_tokencheckinmethod';

let doneCalled = false;

if (isRequestMode()) {
    // 保留旧版单脚本配置的兼容性。
    captureRequest();
} else {
    runTask()
        .then(() => finishScript())
        .catch((e) => {
            $.log(`❌ 执行失败: ${e.message || e}`);
            finishScript();
        });
}

function isRequestMode() {
    return typeof $request !== 'undefined' && $request && typeof $request.url === 'string' && $request.url.length > 0;
}

async function runTask() {
    if (!loadSettings()) return;
    if (!loadCookies()) return;

    $.log(`🌟 开始执行,签到间隔 ${$.req_interval}ms`);
    initState();

    try {
        // 拉所有页关注超话
        let page = 1;
        let sinceId = '';
        while (true) {
            const result = await fetchTopicPage(sinceId);
            if (!result || !result.list || result.list.length === 0) {
                if (page === 1) $.log('⚠️ 第一页没拉到超话,可能是 cookie 或解析问题');
                break;
            }
            $.log(`📃 第 ${page} 页: 拉到 ${result.list.length} 个超话`);
            $.topics.push(...result.list);
            // 不足一页(20条)说明已经是最后一页,不再翻
            if (result.list.length < 20) break;
            if (!result.nextSinceId) break;
            sinceId = result.nextSinceId;
            page++;
            if (page > 20) break;
            await sleep(500);
        }

        // 去重
        const seen = new Set();
        $.topics = $.topics.filter(t => {
            if (seen.has(t.fid)) return false;
            seen.add(t.fid);
            return true;
        });
        $.log(`📊 总计去重后关注超话: ${$.topics.length} 个`);

        for (const t of $.topics) {
            await checkin(t.fid, t.name);
            await sleep($.req_interval);
        }
    } catch (e) {
        $.log(`❌ 执行失败: ${e.message || e}`);
    }

    sendSummary();
}



function captureRequest() {
    if (!$request) {
        $.log('[ERROR] 该脚本仅作为请求重写脚本运行');
        finishScript();
        return;
    }
    const method = String($request.method || '').toUpperCase();
    if (method === 'OPTIONS') {
        finishScript();
        return;
    }

    const url = String($request.url || '');
    const decodedUrl = decodeUrl(url);

    // 兼容新旧微博 APP：新版本使用 topicsub，旧版本仍使用 cardlist。
    if (isNewListRequest(url) || isLegacyListRequest(decodedUrl)) {
        try {
            const headers = $request.headers;
            let body = String($request.body || '');
            if (!body || body.length < 10) {
                body = defaultListBody();
                $.log('[INFO] 列表请求没有 body，使用兼容默认参数');
            }

            const oldUrl = $.getdata(KEY_LIST_URL) || '';
            const initial = !hasPageCursor(url, body) || /taskType=refresh/i.test(body);
            if (!oldUrl || initial) {
                saveData(KEY_LIST_URL, url);
                saveData(KEY_LIST_HEADERS, JSON.stringify(headers || {}));
                saveData(KEY_LIST_BODY, body);
                saveData(KEY_LIST_METHOD, method || 'POST');
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
        finishScript();
        return;
    }

    // 只保存真正的 active_checkin 请求，避免其它 page/button 请求覆盖签到模板。
    if (isCheckinRequest(url, decodedUrl)) {
        try {
            const headers = $request.headers || {};
            const headerText = Object.keys(headers).join(',');
            const hasValidator = /(?:^|,)(?:x-validator|x[_-]validator)(?:,|$)/i.test(headerText);
            saveData(KEY_CHECKIN_URL, url);
            saveData(KEY_CHECKIN_HEADERS, JSON.stringify(headers));
            saveData(KEY_CHECKIN_BODY, String($request.body || ''));
            saveData(KEY_CHECKIN_METHOD, method || 'GET');
            $.log(`[INFO] 已保存签到请求: ${method || 'UNKNOWN'} url=${url.length} X-Validator=${hasValidator ? '有' : '无'}`);

            const listExists = !!$.getdata(KEY_LIST_URL);
            const hint = hasValidator ? '' : '\n⚠️ 本次请求未见 X-Validator，若签到失败请在重写开启时重新手动签到。';
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
        finishScript();
        return;
    }

    finishScript();
}

function isNewListRequest(url) {
    return /\/2\/statuses\/container_timeline_topic(?:sub|page)(?:[/?]|$)/i.test(url);
}

function finishScript(value = {}) {
    if (doneCalled) return;
    doneCalled = true;
    $.done(value);
}

function isLegacyListRequest(url) {
    if (!/\/2\/cardlist(?:[/?]|$)/i.test(url)) return false;
    return /(?:myfollow|followsuper|need[_-]head[_-]cards|super(?:topic)?)/i.test(url);
}

function isCheckinRequest(url, decodedUrl) {
    if (!/\/2\/page\/button(?:[/?]|$)/i.test(url)) return false;
    return /active[_-]checkin/i.test(url) || /active[_-]checkin/i.test(decodedUrl);
}

function hasPageCursor(url, body) {
    return /(?:[?&]|%26)since_id(?:=|%3D)/i.test(url) || /(?:^|&)since_id=/i.test(body);
}

function defaultListBody() {
    return 'filterGroupStyle=1&flowId=232478_-_mine_topic&flowVersion=0.0.1&lfid=profile_me&luicode=10000011&mix_media_enable=1&moduleID=pagecard&orifid=profile_me&oriuicode=10000011&pageDataType=flow&sg_tab_config=2&source_code=10000011_profile_me&taskType=refresh&uicode=10001387';
}

function saveData(key, value) {
    if (!$.setdata(String(value), key)) $.log(`[WARN] 本地数据写入失败: ${key}`);
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

function loadSettings() {
    const deleteValue = $.getdata('wb_delete_cookie');
    $.delete_cookie = deleteValue === true || deleteValue === 'true' || deleteValue === '1';
    $.msg_max_num = parseInt($.getdata('wb_msg_max_num')) || $.msg_max_num;
    $.req_interval = parseInt($.getdata('wb_request_time')) || $.req_interval;

    if ($.delete_cookie) {
        [KEY_LIST_URL, KEY_LIST_HEADERS, KEY_LIST_BODY, KEY_LIST_METHOD,
            KEY_CHECKIN_URL, KEY_CHECKIN_HEADERS, KEY_CHECKIN_BODY, KEY_CHECKIN_METHOD]
            .forEach(k => $.setdata('', k));
        $.setdata('false', 'wb_delete_cookie');
        $.msg($.name, '', '✅ Cookie 已清空,请重新抓取');
        return false;
    }
    return true;
}

function loadCookies() {
    $.listUrl = $.getdata(KEY_LIST_URL);
    $.listHeadersStr = $.getdata(KEY_LIST_HEADERS);
    $.listBody = $.getdata(KEY_LIST_BODY) || '';
    $.listMethod = $.getdata(KEY_LIST_METHOD) || '';
    $.checkinUrl = $.getdata(KEY_CHECKIN_URL);
    $.checkinHeadersStr = $.getdata(KEY_CHECKIN_HEADERS);
    $.checkinBody = $.getdata(KEY_CHECKIN_BODY) || '';
    $.checkinMethod = $.getdata(KEY_CHECKIN_METHOD) || '';

    const missing = [];
    if (!$.listUrl || !$.listHeadersStr) missing.push('列表 cookie');
    if (!$.checkinUrl || !$.checkinHeadersStr) missing.push('签到 cookie');

    if (missing.length > 0) {
        $.msg(
            '微博超话',
            `🚫 缺少 ${missing.join(' + ')}`,
            '请开启 cookie 抓取脚本,然后:\n1️⃣ 进 我的→超话社区→我的→关注\n2️⃣ 进任一超话页面手动签到一次'
        );
        return false;
    }

    try {
        $.listHeaders = JSON.parse($.listHeadersStr);
        $.checkinHeaders = JSON.parse($.checkinHeadersStr);
        $.listMethod = String($.listMethod || inferMethod($.listUrl, 'POST')).toUpperCase();
        $.checkinMethod = String($.checkinMethod || inferMethod($.checkinUrl, 'GET')).toUpperCase();
        return true;
    } catch (e) {
        $.msg('微博超话', '🚫 Cookie 解析失败', '请清空 cookie 后重新抓取');
        return false;
    }
}

function initState() {
    $.topics = [];
    $.successNum = 0;
    $.failNum = 0;
    $.alreadyNum = 0;
    $.message = [];
}

function fetchTopicPage(sinceId) {
    return new Promise((resolve) => {
        const method = $.listMethod === 'GET' ? 'GET' : 'POST';
        const body = sinceId ? replaceParam($.listBody, 'since_id', sinceId) : $.listBody;
        const requestUrl = sinceId ? replaceParam($.listUrl, 'since_id', sinceId) : $.listUrl;
        const cleanedHeaders = cleanHeaders($.listHeaders);
        const opts = { url: requestUrl, headers: cleanedHeaders };
        if (method !== 'GET') opts.body = body;

        $.log(`[列表] ${method} URL长度=${requestUrl.length} headers=${Object.keys(cleanedHeaders).length}个 body长度=${String(body || '').length}`);
        if ($.debug) {
            $.log(`[列表] headers: ${JSON.stringify(cleanedHeaders)}`);
            $.log(`[列表] body: ${String(body || '')}`);
        }

        sendRequest(opts, method, (err, resp, data) => {
            if (err) {
                $.log(`[列表] 请求错误: ${JSON.stringify(err)}`);
                resolve(null);
                return;
            }
            const statusCode = getStatusCode(resp);
            if (statusCode && statusCode !== 200) {
                $.log(`[列表] HTTP ${statusCode}: ${(data || '').substring(0, 200)}`);
                resolve(null);
                return;
            }
            try {
                const obj = typeof data === 'string' ? JSON.parse(data) : data;
                const em = getResponseError(obj);
                if (em) {
                    $.log(`[列表] 微博错误: ${em}`);
                    const hint = '\n\n🔍 风控签名(X-Validator)可能已过期。\n请重新抓 cookie:\n1️⃣ 进 我的→超话社区→我的→关注\n2️⃣ 进任一超话签到一次';
                    $.msg('微博超话', '🚨 拉取关注列表失败', `${em}${hint}`);
                    resolve(null);
                    return;
                }
                const list = extractTopics(obj);
                $.log(`[列表] 解析到 ${list.length} 个超话`);
                const nextSinceId = getNextSinceId(obj);
                resolve({ list, nextSinceId: nextSinceId === '-1_1' ? '' : nextSinceId });
            } catch (e) {
                $.log(`[列表] 解析失败: ${e}`);
                $.log(`[列表] 响应前500: ${(data || '').substring(0, 500)}`);
                resolve(null);
            }
        });
    });
}

function sendRequest(opts, method, callback) {
    if (method === 'GET') $.get(opts, callback);
    else $.post(opts, callback);
}

function getStatusCode(resp) {
    if (!resp) return 0;
    return Number(resp.statusCode || resp.status || 0);
}

function getResponseError(obj) {
    if (!obj || typeof obj !== 'object') return '响应不是 JSON 对象';
    if (obj.errmsg) return String(obj.errmsg);
    if (obj.error_msg) return String(obj.error_msg);
    if (obj.error) return String(obj.error);
    if (obj.errno && String(obj.errno) !== '0') return `errno: ${obj.errno}`;
    if (obj.errcode && String(obj.errcode) !== '0') return `errcode: ${obj.errcode}`;
    if (obj.ok === 0 || obj.result === 0) return String(obj.msg || '微博返回失败');
    return '';
}

function getNextSinceId(obj) {
    const candidates = [
        obj && obj.moreInfo && obj.moreInfo.params && obj.moreInfo.params.since_id,
        obj && obj.data && obj.data.moreInfo && obj.data.moreInfo.params && obj.data.moreInfo.params.since_id,
        obj && obj.cardlistInfo && obj.cardlistInfo.since_id,
        obj && obj.data && obj.data.cardlistInfo && obj.data.cardlistInfo.since_id,
    ];
    const value = candidates.find((item) => item !== undefined && item !== null && item !== '');
    return value ? String(value) : '';
}

// 兼容微博不同版本的 cards/card_group 包装，递归扫描卡片但排除推荐卡。
// 微博现在会把推荐超话也放在同一响应里；推荐卡通常带“+关注/关注”按钮，必须排除。
function extractTopics(obj) {
    const result = [];
    const seen = new Set();
    const scanned = new Set();
    let candidateNum = 0;
    let excludedNum = 0;

    function addTopic(card) {
        if (!card || typeof card !== 'object') return;
        const data = card.data && typeof card.data === 'object' ? card.data : card;
        if (!isTopicCard(card)) return;
        const scheme = data.scheme || data.url || card.scheme || card.url || '';
        const fid = extractTopicId(scheme);
        if (!fid || scanned.has(fid)) return;
        scanned.add(fid);
        candidateNum++;
        if (isFollowActionCard(card)) {
            excludedNum++;
            return;
        }
        const rawName = data.title_sub || data.title || data.name || card.title_sub || card.title || card.name || '';
        if (!rawName) return;
        seen.add(fid);
        result.push({
            fid,
            name: String(rawName).replace(/超话$/, ''),
        });
    }

    function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        addTopic(node);
        Object.values(node).forEach((value) => {
            if (value && typeof value === 'object') walk(value);
        });
    }

    walk(obj);
    $.log(`[列表] 超话卡片筛选: 候选 ${candidateNum} 个,排除推荐 ${excludedNum} 个,保留 ${result.length} 个`);
    return result;
}

function isTopicCard(card) {
    if (!card || typeof card !== 'object') return false;
    const data = card.data && typeof card.data === 'object' ? card.data : card;
    return String(data.card_type || card.card_type) === '8' && !!(data.scheme || data.url || card.scheme || card.url);
}

function isFollowActionCard(card) {
    if (!card || typeof card !== 'object') return false;
    const data = card.data && typeof card.data === 'object' ? card.data : card;
    const labels = [];
    const sources = [
        card.button, data.button, card.ext_button, data.ext_button,
        card.buttons, data.buttons, card.action, data.action,
    ];
    sources.forEach((source) => {
        if (Array.isArray(source)) {
            source.forEach((item) => collectActionLabels(item, labels));
        } else {
            collectActionLabels(source, labels);
        }
    });
    if (labels.some((label) => /^(?:(?:\+|加)?关注|去关注)$/i.test(label.trim()))) return true;
    try {
        return /(?:\+关注|加关注|去关注)/i.test(JSON.stringify(sources));
    } catch (_) {
        return false;
    }
}

function collectActionLabels(source, labels) {
    if (!source || typeof source !== 'object') return;
    ['name', 'title', 'text', 'label', 'caption'].forEach((key) => {
        if (source[key] !== undefined && source[key] !== null) labels.push(String(source[key]));
    });
}

function extractTopicId(value) {
    const decoded = decodeUrl(value);
    const match = decoded.match(/(1008[a-z0-9]{34})/i);
    return match ? match[1] : '';
}

function replaceParam(value, name, nextValue) {
    const source = String(value || '');
    const encodedName = encodeURIComponent(name);
    const pattern = new RegExp(`(^|[?&])${encodedName}=[^&]*`, 'i');
    if (pattern.test(source)) {
        return source.replace(pattern, `$1${encodedName}=${encodeURIComponent(nextValue)}`);
    }
    if (!source) return `${encodedName}=${encodeURIComponent(nextValue)}`;
    const isUrl = /^(?:https?:)?\/\//i.test(source);
    const separator = isUrl ? (source.includes('?') ? '&' : '?') : '&';
    return source + separator + `${encodedName}=${encodeURIComponent(nextValue)}`;
}

// 签到: 用签到 cookie,只替换纯 fid 和 pageid。
// 注意：不要带 _-_recommend；该后缀是微博推荐/关注来源标记，
// 复用到定时请求可能触发“关注后签到”。
function checkin(fid, name) {
    return new Promise((resolve) => {
        const request = buildCheckinRequest(fid);
        const url = request.url;
        const cleanedHeaders = cleanHeaders($.checkinHeaders);
        const opts = { url: url, headers: cleanedHeaders };
        if (request.body) opts.body = request.body;
        const method = request.method === 'POST' ? 'POST' : 'GET';

        if ($.debug) {
            $.log(`[签到 ${name}] ${method} URL: ${url}`);
        }

        sendRequest(opts, method, (err, resp, data) => {
            if (err) {
                $.failNum++;
                $.message.push(`【${name}】❌ 网络错误: ${shortError(err)}`);
                resolve();
                return;
            }
            const code = getStatusCode(resp);
            if (code === 418) { $.failNum++; $.message.push(`【${name}】⚠️ 签到太频繁`); resolve(); return; }
            if (code === 511) { $.failNum++; $.message.push(`【${name}】⚠️ 需要身份验证`); resolve(); return; }
            if (code && code !== 200) { $.failNum++; $.message.push(`【${name}】❌ HTTP ${code}`); resolve(); return; }

            try {
                const r = typeof data === 'string' ? JSON.parse(data) : data;
                const btnName = (r && r.button && r.button.name) || '';
                const errno = r && (r.errno || r.errcode || r.code || r.result);
                const errmsg = getMessage(r);

                const alreadyChecked =
                    String(errno) === '382004'
                    || /已签到|已经签到/.test(errmsg) && !isSuccessResponse(r);

                if (alreadyChecked) {
                    $.alreadyNum++;
                    $.message.push(`【${name}】✨ 今日已签`);
                } else if (isSuccessResponse(r)) {
                    $.successNum++;
                    $.message.push(`【${name}】✅ ${btnName || '签到成功'}`);
                } else if (errmsg) {
                    $.failNum++;
                    $.message.push(`【${name}】❌ ${errmsg}`);
                } else {
                    $.failNum++;
                    $.message.push(`【${name}】❌ 未知响应`);
                    // 仅打到 console,不进通知,避免污染锁屏
                    $.log(`[签到 ${name}] raw: ${(data || '').substring(0, 300)}`);
                }
            } catch (e) {
                $.failNum++;
                $.message.push(`【${name}】❌ 响应解析失败`);
                $.log(`[签到 ${name}] 解析失败 raw: ${(data || '').substring(0, 300)}`);
            }
            resolve();
        });
    });
}

function buildCheckinRequest(fid) {
    const method = String($.checkinMethod || inferMethod($.checkinUrl, 'GET')).toUpperCase();
    const plainFid = String(fid || '').replace(/_-_recommend$/i, '');
    let url = replaceTopicParam($.checkinUrl, 'fid', plainFid);
    url = replacePageId(url, plainFid);
    let body = String($.checkinBody || '');
    if (body) {
        body = replaceTopicParam(body, 'fid', plainFid);
        body = replacePageId(body, plainFid);
    }
    return { url, body, method };
}

// 兼容旧调用方，保留这个函数名。
function buildCheckinUrl(fid) {
    return buildCheckinRequest(fid).url;
}

function replaceTopicParam(source, name, value) {
    const input = String(source || '');
    const encodedName = encodeURIComponent(name);
    const pattern = new RegExp(`(^|[?&])${encodedName}=[^&]*`, 'i');
    if (pattern.test(input)) {
        return input.replace(pattern, `$1${encodedName}=${encodeURIComponent(value)}`);
    }
    return input;
}

function replacePageId(source, fid) {
    let url = String(source || '');
    // request_url 里常见 pageid%3D，也兼容已解码的 pageid=。
    url = url.replace(/(pageid(?:%3D|=))1008[a-z0-9]{34}/gi, `$1${fid}`);
    return url;
}

function inferMethod(url, fallback) {
    return /\/cardlist(?:[/?]|$)/i.test(String(url || '')) ? 'GET' : fallback;
}

function getMessage(r) {
    if (!r || typeof r !== 'object') return '';
    const nested = r.data && typeof r.data === 'object' ? r.data : {};
    return String(
        r.errmsg || r.error_msg || r.msg || nested.errmsg || nested.error_msg ||
        nested.msg || nested.tipMessage || nested.alert_title || ''
    );
}

function isSuccessResponse(r) {
    if (!r || typeof r !== 'object') return false;
    return Number(r.result) === 1 || String(r.code || r.errcode || '') === '100000';
}

function shortError(err) {
    return String(err && (err.message || err.error || err) || '未知错误').substring(0, 80);
}

function cleanHeaders(h) {
    const blocked = ['content-length', 'host', 'connection', 'accept-encoding'];
    const out = {};
    Object.keys(h || {}).forEach((k) => {
        if (!blocked.includes(k.toLowerCase()) && !k.startsWith(':')) {
            out[k] = h[k];
        }
    });
    return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function sendSummary() {
    const total = $.successNum + $.alreadyNum + $.failNum;
    const title = `${$.name}: 新签 ${$.successNum},已签 ${$.alreadyNum},失败 ${$.failNum} (共${total})`;
    if ($.message.length === 0) {
        $.msg(title, '', '⚠️ 没有签到任何超话,请检查 cookie 或关注列表');
        return;
    }
    for (let i = 0; i < $.message.length; i += $.msg_max_num) {
        const chunk = $.message.slice(i, i + $.msg_max_num).join('\n');
        const subtitle = `第 ${Math.floor(i / $.msg_max_num) + 1} 页 / 共 ${Math.ceil($.message.length / $.msg_max_num)} 页`;
        $.msg(title, subtitle, chunk);
    }
}


// @Chavy Env
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
    this.get = (req, cb) => this.send(req, 'GET', cb);
    this.post = (req, cb) => this.send(req, 'POST', cb);
    this.send = (req, method, cb) => {
        if (this.isSurge() || this.isLoon()) {
            const fn = method === 'POST' ? $httpClient.post : $httpClient.get;
            fn(req, (err, resp, data) => {
                if (resp) { resp.body = data; resp.statusCode = resp.status || resp.statusCode; }
                cb(err, resp, data);
            });
        } else if (this.isQuanX()) {
            req.method = method;
            $task.fetch(req).then(
                (r) => { r.status = r.statusCode; cb(null, r, r.body); },
                (e) => cb(e.error || e, null, null)
            );
        }
    };
    this.done = (v = {}) => { if (typeof $done !== 'undefined') $done(v); };
}
