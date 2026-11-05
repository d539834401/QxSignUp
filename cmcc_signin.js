/**
 * 中国移动 App「签到有礼」（Quantumult X）
 * Copyright (c) 2026 d539834401
 * Version: 20261105.1
 *
 * 按公开接口资料独立实现（非 Python 源码复制）：
 * https://github.com/mli84/cmcc-auto-checkin/tree/a34f305eeb83b1327444f56fce434276e2c6d98c
 * 参考 cmcc_sign.py 的 mark31/SSO 协议、cmcc_session.py 的会话加密协议。
 *
 * 合并 cmcc_signin.conf，依次冷启动中国移动 App、进入「签到有礼」。
 * 抓取只保存在本机 $prefs，不主动登录或签到；收到完整参数通知后关闭抓取规则。
 * 单账号；账号切换时清空旧账号参数，需重新完成两次抓取。
 * 每日签到并领取免费累计/连签奖励；不包括其它活动。
 * 可设置 cmcc_signin_claim_awards=false 关闭累计奖励代领。
 * 已通过离线模拟 QX 和密码学测试，尚未使用真实账号在 iPhone 上验证。
 */

const SCRIPT_NAME = "中国移动签到";
const SCRIPT_VERSION = "20261105.1";
const PROFILE_KEY = "cmcc_signin_profile_v1";
const STATUS_KEY = "cmcc_signin_status_v1";
const BASE = "https://wx.10086.cn";
const ACTIVITY_URL = BASE + "/qwhdhub/qwhdmark/1021122301?channelId=P00000109876";
const MARK_PATH = "/qwhdhub/api/mark/mark31/";
const NATIVE_URL = /^https:\/\/client\.app\.coc\.10086\.cn\/biz-orange\/LN\/(?:uamonekeylogin|uamrandcodelogin)\/autoLogin$/;
const SSO_URL = /^https:\/\/wx\.10086\.cn\/qwhdsso\/appTokenLogin\?sid=[^&#\s]+$/;
const BUDGET_MS = 50000;
const REQUEST_MS = 6500;
const REQ_KEY = "tVkdaRWRY0ZkV1Vr";
const RESP_KEY = "RYV0hCV1lV25KYVJ";
const REQ_IV = "VjFSQ1ZtVkQxRTlQ";
let deadline = 0;
let finished = false;

function finish() {
  if (!finished) { finished = true; $done({}); }
}

function failure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

function object(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function header(headers, name) {
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === name.toLowerCase()) return headers[keys[i]];
  }
  return "";
}

function parseObject(text) {
  let value;
  try { value = JSON.parse(text); } catch (_) { return null; }
  return object(value) ? value : null;
}

function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10).replace(/-/g, ""); }

function cleanHeader(value) { return typeof value === "string" && !/[\r\n\0]/.test(value) ? value : ""; }

function phoneFromCheckId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8,12}$/i.test(value)) return "";
  const phone = String(parseInt(value, 16));
  return /^1\d{10}$/.test(phone) ? phone : "";
}

function validSso(sso, phone) {
  return object(sso) && phoneFromCheckId(sso.userCheckId) === phone &&
    !!cleanHeader(sso.token) && /(?:^|;\s*)JSESSIONID=[^;\s]+/.test(sso.token) &&
    /^\d{2,5}$/.test(sso.provinceCode) && /^\d{2,6}$/.test(sso.cityCode) &&
    /^\d{1,4}$/.test(sso.carrierOperator) && /^[\d.]{1,24}$/.test(sso.appVersionCode) &&
    !!cleanHeader(sso.userAgent);
}

function validNative(native, phone) {
  if (!object(native) || !NATIVE_URL.test(native.url) || !cleanHeader(native.userAgent)) return false;
  const template = parseObject(native.plain);
  return !!template && template.tel === phone && typeof template.xk === "string" &&
    /^[a-z0-9]{8,256}$/i.test(template.xk) && object(template.reqBody) &&
    typeof template.reqBody.cellNum === "string" && template.reqBody.cellNum.length > 20;
}

function capture() {
  if (String($request.method || "GET").toUpperCase() !== "POST") return;
  const url = String($request.url || "");
  const userAgent = cleanHeader(header($request.headers, "user-agent"));
  let phone, part, value;
  if (SSO_URL.test(url)) {
    const body = parseObject($request.body);
    if (!body) throw failure("capture", "登录请求体不可读，请确认使用 script-request-body 并重新进入签到页。");
    phone = phoneFromCheckId(body.userCheckId);
    value = {
      token: body.token, userCheckId: body.userCheckId,
      provinceCode: String(body.provinceCode || ""), cityCode: String(body.cityCode || ""),
      carrierOperator: String(body.carrierOperator || ""), appVersionCode: String(body.appVersionCode || ""), userAgent: userAgent
    };
    if (!phone || !validSso(value, phone)) throw failure("capture", "登录参数不完整，尚未保存；请重新登录中国移动 App 并进入签到页。");
    part = "sso";
  } else if (NATIVE_URL.test(url)) {
    let plain;
    try { plain = aesDecrypt(String($request.body || "").trim(), REQ_KEY, REQ_IV); }
    catch (_) { throw failure("capture", "冷启动请求无法解密，尚未保存；请确认抓取请求体，或检查 App 协议是否已更新。"); }
    const template = parseObject(plain);
    phone = template && String(template.tel || "");
    value = { url: url, plain: plain, userAgent: userAgent, cookie: cleanHeader(header($request.headers, "cookie")) };
    if (!/^1\d{10}$/.test(phone) || !validNative(value, phone)) throw failure("capture", "冷启动模板缺少真实登录和设备参数，尚未保存；请冷启动 App 重新抓取。");
    part = "native";
  } else return;

  const previous = parseObject($prefs.valueForKey(PROFILE_KEY));
  const profile = previous && previous.version === 1 && previous.phone === phone ? previous : { version: 1, phone: phone };
  const changed = JSON.stringify(profile[part]) !== JSON.stringify(value);
  profile[part] = value;
  // 登录票据变化时丢弃旧活动会话；无身份信息的活动 Cookie 不参与账号合并。
  if (changed) delete profile.session;
  if (!$prefs.setValueForKey(JSON.stringify(profile), PROFILE_KEY)) throw failure("capture", "本机参数保存失败，请检查 QX 持久化存储后重新抓取。");
  const ready = validSso(profile.sso, phone) && validNative(profile.native, phone);
  if (changed) $notify(SCRIPT_NAME, ready ? "参数获取完整 ✅" : "已保存部分参数", ready
    ? "请关闭两条抓取规则，再手动运行签到任务。"
    : part === "sso" ? "还需完全关闭并重新打开中国移动 App，抓取冷启动会话模板。"
      : "还需进入中国移动 App 的「签到有礼」页，抓取签到登录参数。");
}

function loadAccount() {
  const raw = $prefs.valueForKey(PROFILE_KEY) || "";
  const profile = parseObject(raw);
  if (!profile || profile.version !== 1 || !/^1\d{10}$/.test(profile.phone) || !validSso(profile.sso, profile.phone)) {
    throw failure("config", "请开启抓取规则，冷启动中国移动 App 后进入「签到有礼」，获取登录参数。");
  }
  return { profile: profile, snapshot: raw, refreshed: false };
}

function unchanged(account) { return ($prefs.valueForKey(PROFILE_KEY) || "") === account.snapshot; }

function guardAccount(account) {
  if (!unchanged(account)) throw failure("changed", "运行期间本机登录参数已变化；请使用新参数重新运行任务。");
}

function saveAccount(account) {
  guardAccount(account);
  const raw = JSON.stringify(account.profile);
  if (!$prefs.setValueForKey(raw, PROFILE_KEY)) throw failure("storage", "本机会话保存失败，请检查 QX 存储后重试。");
  account.snapshot = raw;
}

function timedFetch(url, method, headers, body, acceptsRedirect) {
  const allowed = url.indexOf(BASE + "/") === 0 || NATIVE_URL.test(url);
  if (!allowed || /[\s#]/.test(url)) return Promise.reject(failure("protocol", "接口跳转地址不符合当前活动配置。"));
  const timeout = Math.min(REQUEST_MS, deadline - Date.now());
  if (timeout < 800) return Promise.reject(failure("budget", "任务时间不足，请稍后手动运行。"));
  const options = { url: url, method: method, headers: headers, opts: { redirection: false, "auto-cookie": false } };
  if (body !== undefined) options.body = body;
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; reject(failure("network", "请求超时，请在 App 核对结果后重试。")); }
    }, timeout);
    Promise.resolve().then(function () { return $task.fetch(options); }).then(function (response) {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      const code = Number(response.statusCode);
      if (code === 401) reject(failure("auth", "登录状态已过期，请重新抓取登录参数。"));
      else if (code === 403) reject(failure("denied", "服务端拒绝请求，请检查抓取参数、网络出口或 App 协议变化。"));
      else if (code === 429) reject(failure("limited", "服务端限流，请稍后再试。"));
      else if (code >= 500) reject(failure("server", "中国移动服务暂不可用，请稍后再试。"));
      else if (!(code >= 200 && code < 300) && !(acceptsRedirect && code >= 300 && code < 400)) reject(failure("protocol", "接口返回异常 HTTP 状态，请在 App 核对。"));
      else resolve(response);
    }, function () {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      reject(failure("network", "网络请求失败，请检查 QX 网络连接。"));
    });
  });
}

function cookieMap(raw) {
  const result = {};
  const values = Array.isArray(raw) ? raw : [raw];
  values.forEach(function (value) {
    String(value || "").split(/,(?=\s*[^=;,\s]+=)/).forEach(function (line) {
      line.split(";").forEach(function (piece) {
        const match = piece.trim().match(/^([a-z0-9_-]+)=([^;\r\n]*)$/i);
        if (!match || /^(?:path|domain|expires|max-age|samesite|priority)$/i.test(match[1])) return;
        if (match[2] && !/[\s,]/.test(match[2])) result[match[1]] = match[2];
      });
    });
  });
  return result;
}

function authError(body) {
  const code = String(body.code || body.status || "");
  return /^(?:NOT_LOGIN|NO_LOGIN|UNAUTHORIZED|LOGIN_EXPIRED|SESSION_EXPIRED|SESSION_TIMEOUT)$/.test(code) ||
    /登录.{0,12}(?:过期|失效|超时)|(?:重新|请先)登录|(?:token|cookie|会话).{0,12}(?:过期|失效)/i.test(String(body.msg || ""));
}

function jsonResponse(response) {
  const body = parseObject(response.body);
  if (!body) throw failure("protocol", "接口未返回预期 JSON 对象，请稍后重试或检查协议更新。");
  if (body.code !== "SUCCESS") {
    if (authError(body)) throw failure("auth", "登录状态已过期，请重新抓取登录参数。");
    throw failure("business", "活动接口未确认成功，请打开 App 查看活动提示。");
  }
  return body;
}

function webHeaders(account, referer, cookie) {
  return { "User-Agent": account.profile.sso.userAgent, Accept: "*/*", "Content-Type": "application/json;charset=UTF-8",
    Origin: BASE, Referer: referer, "login-check": "1", "x-requested-with": "XMLHttpRequest", Cookie: cookie || "" };
}

async function refreshNative(account) {
  if (account.refreshed) throw failure("auth", "会话恢复后仍未通过登录，请在 App 重新登录并抓取参数。");
  account.refreshed = true;
  const profile = account.profile;
  if (!validNative(profile.native, profile.phone)) throw failure("auth", "登录票据已过期；请开启冷启动抓取规则，完全关闭并重新打开中国移动 App，再进入签到页。");
  const last = Number(profile.nativeAttemptAt) || 0;
  if (last && Date.now() - last < 65000) throw failure("limited", "一分钟内已尝试恢复会话，请稍后再运行，避免登录限流。");
  profile.nativeAttemptAt = Date.now();
  saveAccount(account);
  const native = profile.native;
  const template = parseObject(native.plain);
  const cookie = /(?:^|;\s*)JSESSIONID=[^;\s]+/.test(native.cookie || "") ? native.cookie : profile.sso.token;
  const jsid = cookie.match(/(?:^|;\s*)JSESSIONID=([^;\s]+)/)[1];
  const time = String(Date.now());
  const nonce = String(10000000 + Math.floor(Math.random() * 90000000));
  const path = native.url.slice("https://client.app.coc.10086.cn".length);
  const token = aesEncrypt(template.xk + "_" + path + "_" + time + "_" + nonce, "bAIgvwAuA4tbDr9d", "9791027341711819");
  const headers = {
    "x-qen": "14", Accept: "*/*", "Content-Type": "application/Json", "User-Agent": native.userAgent, Cookie: cookie,
    "x-time": time, "x-nonce": nonce, "x-token": token,
    xs: md5(native.url + "_" + native.plain + "_Leadeon/SecurityOrganization"),
    "x-sign": md5(token + "_" + time + "_" + nonce + "_" + jsid)
  };
  const response = await timedFetch(native.url, "POST", headers, aesEncrypt(native.plain, REQ_KEY, REQ_IV));
  let body = parseObject(response.body);
  if (!body) {
    try { body = parseObject(aesDecrypt(String(response.body || "").trim(), RESP_KEY, REQ_IV)); }
    catch (_) { /* 统一在下面报告协议变化，不输出原始密文或凭据。 */ }
  }
  if (!body) throw failure("protocol", "会话响应无法解密，请重新抓取冷启动模板或检查 App 协议更新。");
  const code = String(body.retCode || "");
  if (code === "233031") throw failure("limited", "登录请求过于频繁，请至少一分钟后重试。");
  if (code === "420000") throw failure("auth", "服务端提示其它设备会话占用，请在本人手机的中国移动 App 重新登录后再抓取。");
  if (code !== "000000") throw failure("auth", "服务端未恢复 App 会话，请重新登录并抓取冷启动模板。");
  const cookies = cookieMap(header(response.headers, "set-cookie"));
  if (!cookies.JSESSIONID) throw failure("protocol", "会话接口未下发新 JSESSIONID，请重新抓取参数。");
  const fresh = Object.keys(cookies).map(function (name) { return name + "=" + cookies[name]; }).join("; ");
  profile.sso.token = fresh;
  profile.native.cookie = fresh;
  delete profile.session;
  saveAccount(account);
}

async function exchangeSession(account) {
  guardAccount(account);
  const login = await timedFetch(BASE + "/qwhdsso/login?dlwmh=true&actUrl=" + encodeURIComponent(ACTIVITY_URL), "GET",
    { "User-Agent": account.profile.sso.userAgent, Accept: "text/html" });
  const match = String(login.body || "").match(/\bloginPath\s*=\s*['"](\/appTokenLogin\?sid=[a-z0-9._~-]+)['"]/i);
  if (!match) throw failure("protocol", "登录中转页未提供预期 sid；活动入口可能已更新。");
  const url = BASE + "/qwhdsso" + match[1];
  async function loginWithTicket() {
    const sso = account.profile.sso;
    const body = { provinceCode: sso.provinceCode, cityCode: sso.cityCode, userCheckId: sso.userCheckId,
      carrierOperator: sso.carrierOperator, appVersionCode: sso.appVersionCode, took: 300, jwtToken: null, token: sso.token };
    return jsonResponse(await timedFetch(url, "POST", webHeaders(account, ACTIVITY_URL), JSON.stringify(body)));
  }
  let result;
  try { result = await loginWithTicket(); }
  catch (error) {
    if (error.kind !== "auth") throw error;
    await refreshNative(account);
    result = await loginWithTicket();
  }
  const destination = object(result.data) && result.data.url;
  if (typeof destination !== "string" || !/^https:\/\/wx\.10086\.cn\/qwhdhub\/qwhdmark\/1021122301\?[^#\s]+$/.test(destination)) {
    throw failure("protocol", "登录返回了不同的活动地址，请检查签到活动是否已改版。");
  }
  const page = await timedFetch(destination, "GET", { "User-Agent": account.profile.sso.userAgent, Accept: "text/html" }, undefined, true);
  const cookies = cookieMap(header(page.headers, "set-cookie"));
  if (!cookies.QWHD_SESSION_TOKEN) throw failure("auth", "活动页未下发签到会话，请在 App 重新进入签到页抓取。");
  const session = { cookie: "QWHD_SESSION_TOKEN=" + cookies.QWHD_SESSION_TOKEN, referer: destination, createdAt: Date.now() };
  account.profile.session = session;
  saveAccount(account);
  return session;
}

function cachedSession(account) {
  const s = account.profile.session;
  if (!object(s) || !/^QWHD_SESSION_TOKEN=[^;\s,]+$/.test(s.cookie) ||
      !/^https:\/\/wx\.10086\.cn\/qwhdhub\/qwhdmark\/1021122301\?[^#\s]+$/.test(s.referer)) return null;
  const age = Date.now() - Number(s.createdAt);
  return age >= 0 && age < 20 * 60000 ? s : null;
}

async function markApi(account, session, path, body) {
  return jsonResponse(await timedFetch(BASE + MARK_PATH + path, "POST", webHeaders(account, session.referer, session.cookie), JSON.stringify(body || {})));
}

async function queryStatus(account, session, day) {
  const body = await markApi(account, session, "markstatus", {});
  const data = body.data;
  if (!object(data) || !Array.isArray(data.markstatus) || data.markstatus.some(function (row) {
    return !object(row) || !/^\d{8}$/.test(String(row.date));
  })) throw failure("protocol", "签到状态结构已变化，无法确认当天状态，请在 App 核对。");
  const rows = data.markstatus.filter(function (row) { return String(row.date) === day; });
  if (rows.length > 1 || rows.some(function (row) { return row.status !== 0 && row.status !== 1 && row.status !== "0" && row.status !== "1"; })) {
    throw failure("protocol", "当天签到状态无法识别，请在 App 核对。");
  }
  return { signed: rows.length === 1 && String(rows[0].status) === "1", data: data };
}

function summary(data) {
  const count = object(data.userinfo) && data.userinfo.accumulateTimes;
  return /^\d{1,4}$/.test(String(count)) ? "累计签到 " + count + " 天。" : "";
}

function prizeText(value) {
  // 奖品显示不使用服务端任意文本；仅给出已知奖励类型和数值。
  if (!object(value)) return "";
  const category = { FLOW: "流量", FEE: "话费" }[value.prizeCategory];
  const amount = String(value.prizeValue || "");
  return category && /^\d+(?:\.\d{1,2})?$/.test(amount) ? category + " " + amount + (value.prizeCategory === "FLOW" ? "MB" : "元") : "";
}

async function claimAwards(account, session, data, day) {
  if (String($prefs.valueForKey("cmcc_signin_claim_awards")).toLowerCase() === "false") return "累计奖励代领已关闭。";
  const tasks = data.taskAwardChance;
  if (tasks === undefined || tasks === null) return "";
  if (!Array.isArray(tasks)) return "累计奖励列表无法识别，请在 App 查看。";
  const ids = [];
  tasks.forEach(function (task) {
    const id = object(task) ? String(task.id || "") : "";
    if (/^[a-z0-9_-]{1,48}$/i.test(id) && ids.indexOf(id) < 0) ids.push(id);
  });
  let count = 0;
  const notes = [];
  for (let i = 0; i < ids.length; i += 1) {
    if (i >= 4 || deadline - Date.now() < 2500 || today() !== day) { notes.push("还有累计奖励未处理，请在 App 查看。"); break; }
    guardAccount(account);
    try {
      const result = await markApi(account, session, "taskAward/" + ids[i], {});
      if (object(result.data) && typeof result.data.prizeName === "string" && result.data.prizeName) {
        count += 1;
        const text = prizeText(result.data);
        if (text) notes.push(text);
      } else notes.push("累计奖励已请求，到账明细请在 App 核对。");
    } catch (_) { notes.push("累计奖励领取未确认，请在 App 查看；本次不重发。"); break; }
  }
  if (count) notes.unshift("已确认领取 " + count + " 项累计/连签奖励。");
  return notes.join(" ");
}

function report(account, day, title, message, signed) {
  if (unchanged(account)) $prefs.setValueForKey(JSON.stringify({ day: day, signed: signed, checkedAt: Date.now() }), STATUS_KEY);
  $notify(SCRIPT_NAME, title, message);
}

async function runTask() {
  deadline = Date.now() + BUDGET_MS;
  const account = loadAccount();
  const day = today();
  let session = cachedSession(account);
  const cached = !!session;
  if (!session) session = await exchangeSession(account);
  let state;
  try { state = await queryStatus(account, session, day); }
  catch (error) {
    if (!cached || error.kind !== "auth") throw error;
    delete account.profile.session;
    saveAccount(account);
    session = await exchangeSession(account);
    state = await queryStatus(account, session, day);
  }
  let title = "今日已签到 ✅";
  let dailyPrize = "";
  if (!state.signed) {
    guardAccount(account);
    if (today() !== day) throw failure("day", "任务已跨北京时间零点，请重新运行确认新一天状态。");
    if (deadline - Date.now() < REQUEST_MS + 1500) throw failure("budget", "剩余时间不足以完成签到和核验，请稍后重新运行。");
    let result, submitError;
    try { result = await markApi(account, session, "domark", { date: day }); }
    catch (error) { submitError = error; }
    // 提交超时/5xx 或返回 SUCCESS，都只查询核验；不重发签到。
    try { state = await queryStatus(account, session, day); }
    catch (_) {
      report(account, day, "签到结果待确认", "已尝试签到，但无法重新查询状态；请在 App 核对，本次不重发。", false);
      return;
    }
    if (today() !== day) {
      report(account, day, "签到结果待确认", "任务跨越北京时间零点，请在 App 核对两个日期的签到记录。", false);
      return;
    }
    if (!state.signed) {
      const uncertain = !submitError || ["network", "server", "budget"].indexOf(submitError.kind) >= 0;
      report(account, day, uncertain ? "签到结果待确认" : "签到未完成", uncertain
        ? "服务端尚未确认当天已签；请在 App 核对，本次不重发。" : submitError.message, false);
      return;
    }
    title = "签到已确认 ✅";
    const prize = result && object(result.data) && prizeText(result.data.markPrize);
    if (prize) dailyPrize = "签到接口返回奖励：" + prize + "；到账以 App 为准。";
  }
  guardAccount(account);
  const awards = await claimAwards(account, session, state.data, day);
  report(account, day, title, [summary(state.data), dailyPrize, awards].filter(Boolean).join(" ") || "已查询确认当日签到记录。", true);
}

// 单文件的 UTF-8、Base64、AES-128-CBC/PKCS7 与 MD5；运行时不下载或执行第三方代码。
function utf8(text) {
  const encoded = encodeURIComponent(text);
  const out = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%") { out.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(encoded.charCodeAt(i));
  }
  return out;
}

function fromUtf8(bytes) { return decodeURIComponent(bytes.map(function (b) { return "%" + ("0" + b.toString(16)).slice(-2); }).join("")); }

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

function unbase64(text) {
  if (!text || text.length % 4 || !/^(?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?$/i.test(text)) throw new Error("Invalid base64");
  const out = [];
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64.indexOf(text[i]) << 18) | (B64.indexOf(text[i + 1]) << 12) | ((text[i + 2] === "=" ? 0 : B64.indexOf(text[i + 2])) << 6) | (text[i + 3] === "=" ? 0 : B64.indexOf(text[i + 3]));
    out.push((n >>> 16) & 255);
    if (text[i + 2] !== "=") out.push((n >>> 8) & 255);
    if (text[i + 3] !== "=") out.push(n & 255);
  }
  return out;
}

function gf(a, b) {
  let out = 0;
  for (let i = 0; i < 8; i += 1) { if (b & 1) out ^= a; a = ((a << 1) ^ (a & 128 ? 0x11b : 0)) & 255; b >>>= 1; }
  return out;
}

const SBOX = [], INVBOX = [];
for (let b = 0; b < 256; b += 1) {
  let inverse = 0;
  if (b) { inverse = 1; for (let k = 0; k < 254; k += 1) inverse = gf(inverse, b); }
  let s = inverse ^ 0x63;
  for (let shift = 1; shift <= 4; shift += 1) s ^= ((inverse << shift) | (inverse >>> (8 - shift))) & 255;
  SBOX[b] = s; INVBOX[s] = b;
}

function aesKeys(key) {
  const keys = utf8(key);
  if (keys.length !== 16) throw new Error("Invalid AES key");
  let rcon = 1;
  while (keys.length < 176) {
    let word = keys.slice(-4);
    if (keys.length % 16 === 0) { word.push(word.shift()); word = word.map(function (b) { return SBOX[b]; }); word[0] ^= rcon; rcon = gf(rcon, 2); }
    for (let i = 0; i < 4; i += 1) keys.push(keys[keys.length - 16] ^ word[i]);
  }
  return keys;
}

function aesBlock(block, keys, decrypt) {
  let state = block.slice();
  function add(round) { for (let i = 0; i < 16; i += 1) state[i] ^= keys[round * 16 + i]; }
  function shift(inverse) {
    const old = state.slice();
    for (let row = 0; row < 4; row += 1) for (let col = 0; col < 4; col += 1) state[row + 4 * col] = old[row + 4 * ((col + (inverse ? 4 - row : row)) % 4)];
  }
  function mix(inverse) {
    const first = inverse ? [14, 11, 13, 9] : [2, 3, 1, 1];
    for (let c = 0; c < 16; c += 4) {
      const old = state.slice(c, c + 4);
      for (let r = 0; r < 4; r += 1) { state[c + r] = 0; for (let k = 0; k < 4; k += 1) state[c + r] ^= gf(old[k], first[(k - r + 4) % 4]); }
    }
  }
  add(decrypt ? 10 : 0);
  for (let step = 1; step <= 10; step += 1) {
    if (decrypt) { shift(true); state = state.map(function (b) { return INVBOX[b]; }); add(10 - step); if (step < 10) mix(true); }
    else { state = state.map(function (b) { return SBOX[b]; }); shift(false); if (step < 10) mix(false); add(step); }
  }
  return state;
}

function aesEncrypt(plain, key, iv) {
  const bytes = utf8(plain), keys = aesKeys(key);
  let previous = utf8(iv);
  if (previous.length !== 16) throw new Error("Invalid AES IV");
  const padding = 16 - bytes.length % 16;
  for (let i = 0; i < padding; i += 1) bytes.push(padding);
  const result = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const block = bytes.slice(offset, offset + 16).map(function (b, index) { return b ^ previous[index]; });
    previous = aesBlock(block, keys, false);
    Array.prototype.push.apply(result, previous);
  }
  return base64(result);
}

function aesDecrypt(ciphertext, key, iv) {
  const bytes = unbase64(ciphertext), keys = aesKeys(key);
  let previous = utf8(iv);
  if (!bytes.length || bytes.length % 16 || previous.length !== 16) throw new Error("Invalid AES input");
  const result = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const block = bytes.slice(offset, offset + 16);
    const plain = aesBlock(block, keys, true).map(function (b, index) { return b ^ previous[index]; });
    Array.prototype.push.apply(result, plain); previous = block;
  }
  const pad = result[result.length - 1];
  if (pad < 1 || pad > 16 || result.slice(-pad).some(function (b) { return b !== pad; })) throw new Error("Invalid PKCS7");
  return fromUtf8(result.slice(0, -pad));
}

function md5(text) {
  const bytes = utf8(text), bitLength = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i += 1) bytes.push(Math.floor(bitLength / Math.pow(256, i)) & 255);
  const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  const accum = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 16; i += 1) words.push(bytes[offset + i * 4] | (bytes[offset + i * 4 + 1] << 8) | (bytes[offset + i * 4 + 2] << 16) | (bytes[offset + i * 4 + 3] << 24));
    let a = accum[0], b = accum[1], c = accum[2], d = accum[3];
    for (let i = 0; i < 64; i += 1) {
      let f, index;
      if (i < 16) { f = (b & c) | (~b & d); index = i; }
      else if (i < 32) { f = (d & b) | (~d & c); index = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; index = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); index = (7 * i) % 16; }
      const sum = (a + f + words[index] + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)) | 0;
      const shift = shifts[Math.floor(i / 16)][i % 4];
      const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = d; d = c; c = b; b = next;
    }
    [a, b, c, d].forEach(function (word, index) { accum[index] = (accum[index] + word) | 0; });
  }
  return accum.map(function (word) { let out = ""; for (let i = 0; i < 4; i += 1) out += ("0" + ((word >>> (8 * i)) & 255).toString(16)).slice(-2); return out; }).join("");
}

(async function () {
  console.log("[中国移动] 脚本版本 " + SCRIPT_VERSION);
  try {
    if (typeof $request !== "undefined") capture();
    else await runTask();
  } catch (error) {
    // 外部网络/解析错误可能带凭据，输出只使用本脚本生成的固定消息。
    $notify(SCRIPT_NAME, typeof $request !== "undefined" ? "参数获取未完成" : "任务未完成", error.kind ? error.message : "执行异常，请检查本机参数或反馈脚本版本；原始响应未写入日志。");
  } finally { finish(); }
})();
