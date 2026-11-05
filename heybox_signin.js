/**
 * 小黑盒每日签到（Quantumult X，iOS 单账号）
 * Copyright (c) 2026 MaYIHEI, Cansiny0320, XiaHouSheng
 * Copyright (c) 2026 d539834401 — Quantumult X adaptation
 * SPDX-License-Identifier: MIT
 * Licenses: licenses/heybox-*.txt
 * Version: 20261105.1
 *
 * iOS 签名与密码学原语基于 MaYIHEI/paperclip，签到核验参考 Cansiny0320/heybox-daily。
 * 合并 heybox_signin.conf，进入小黑盒“我的 → 签到”捕获参数，随后关闭抓取规则。
 * 凭据仅保存于本机 $prefs；只请求 api.xiaoheihe.cn，不使用远程签名服务。
 * 先查当日状态，未签才提交一次；提交后轮询并查询当日签到入账。
 * 状态确认和奖励到账分别报告，处理中/超时/缺少日期不报成功。
 * 离线 QX 沙箱与密码学测试通过后仍需当前 iPhone/App 实机验证。
 */

const SCRIPT_NAME = "小黑盒签到";
const SCRIPT_VERSION = "20261105.1";
const STORE_PROFILE = "heybox_signin_profile_v1";
const STORE_STATUS = "heybox_signin_status_v1";
const API_BASE = "https://api.xiaoheihe.cn";
const CAPTURE_PATH = /^\/task\/(?:sign_list|list_v2|sign_v[34]\/get_sign_state)\/?$/;
const STATE_PATH = /^\/task\/sign_v[34]\/get_sign_state$/;
const PARAM_KEYS = ["dw", "lang", "version", "device_info", "os_type", "os_version", "x_os_type", "x_client_type", "heybox_id", "time_zone", "x_app", "device_id"];
const TASK_BUDGET_MS = 40000;
const REQUEST_TIMEOUT_MS = 6500;
const POLL_DELAYS_MS = [1000, 1500, 2500];
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

function header(headers, name) {
  const key = Object.keys(headers || {}).find(function (key) { return key.toLowerCase() === name; });
  return key === undefined ? "" : String(headers[key]);
}

function cookieField(raw, name) {
  const parts = String(raw || "").split(";");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (part.slice(0, name.length + 1) === name + "=") return part.slice(name.length + 1);
  }
  return "";
}

function validCookie(value) {
  return typeof value === "string" && value.length > 0 && value.length < 8192 && !/[^\x21-\x7e]|[;,"\\]/.test(value);
}

function parseCaptureUrl(url) {
  const match = /^https:\/\/api\.xiaoheihe\.cn(\/[^?#]*)(?:\?([^#]*))?$/.exec(String(url || ""));
  if (!match || !CAPTURE_PATH.test(match[1])) return null;
  const query = Object.create(null);
  String(match[2] || "").split("&").forEach(function (part) {
    const i = part.indexOf("=");
    if (i < 0) return;
    const key = decodeURIComponent(part.slice(0, i));
    if (PARAM_KEYS.indexOf(key) < 0) return;
    const value = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
    if (Object.prototype.hasOwnProperty.call(query, key) && query[key] !== value) throw failure("config", "请求参数重复，请重新进入签到页。");
    query[key] = value;
  });
  return { path: match[1].replace(/\/$/, ""), query: query };
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw failure("config", "本地参数不完整，请重新抓取。");
  const params = profile.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) throw failure("config", "本地设备参数不完整，请重新抓取。");
  if (!validCookie(profile.pkey) || (profile.tokenid && !validCookie(profile.tokenid))) throw failure("config", "本地 Cookie 格式无效，请重新抓取。");
  const required = ["device_id", "heybox_id", "version", "os_version"];
  if (required.some(function (key) { return typeof params[key] !== "string" || !params[key] || params[key].length > 256 || /[\x00-\x1f\x7f]/.test(params[key]); }) ||
      params.x_app !== "heybox" || !/^\d+$/.test(params.heybox_id) || !/^\d+(?:\.\d+){2,3}$/.test(params.version) ||
      !/^ios$/i.test(String(params.os_type || params.x_os_type || ""))) {
    throw failure("config", "需要完整的 iOS 小黑盒请求，请进入“我的 → 签到”重新抓取。");
  }
  if (PARAM_KEYS.some(function (key) { return params[key] !== undefined && (typeof params[key] !== "string" || params[key].length > 512 || /[\x00-\x1f\x7f]/.test(params[key])); }) ||
      typeof profile.userAgent !== "string" || !profile.userAgent || profile.userAgent.length > 1024 || /[\r\n]/.test(profile.userAgent) ||
      !STATE_PATH.test(profile.statePath)) throw failure("config", "本地请求参数无效，请重新抓取。");
  return profile;
}

function profileId(profile) {
  return md5hex(utf8Bytes(profile.params.heybox_id + ":" + profile.params.device_id));
}

function captureProfile() {
  if (String($request.method || "GET").toUpperCase() !== "GET") return;
  const parsed = parseCaptureUrl($request.url);
  if (!parsed) return;
  const params = {};
  PARAM_KEYS.forEach(function (key) { if (parsed.query[key] !== undefined) params[key] = parsed.query[key]; });
  const cookie = header($request.headers, "cookie");
  const profile = {
    params: params, pkey: cookieField(cookie, "pkey"), tokenid: cookieField(cookie, "x_xhh_tokenid"),
    userAgent: header($request.headers, "user-agent"), statePath: "/task/sign_v3/get_sign_state"
  };
  if (!profile.pkey) { console.log("[小黑盒] 请求已命中，但缺少 pkey；请确认已登录并进入签到页。"); return; }
  let previous = null;
  try { previous = JSON.parse($prefs.valueForKey(STORE_PROFILE) || "null"); } catch (error) { /* 允许重新抓取修复旧配置。 */ }
  if (STATE_PATH.test(parsed.path)) profile.statePath = parsed.path;
  else if (previous && previous.params && previous.params.device_id === params.device_id && previous.params.heybox_id === params.heybox_id &&
      previous.params.version === params.version && STATE_PATH.test(previous.statePath)) profile.statePath = previous.statePath;
  validateProfile(profile);
  const raw = JSON.stringify(profile);
  if (raw === $prefs.valueForKey(STORE_PROFILE)) return;
  if (!$prefs.setValueForKey(raw, STORE_PROFILE) || $prefs.valueForKey(STORE_PROFILE) !== raw) throw failure("config", "本机存储写入失败，请重新抓取。");
  if (!previous || !previous.params || previous.params.heybox_id !== params.heybox_id || previous.params.device_id !== params.device_id) $prefs.setValueForKey("", STORE_STATUS);
  $notify(SCRIPT_NAME, "参数获取成功 ✅", "已保存到本机；请关闭抓取规则，再手动运行一次签到任务。");
}

function todayNumber(time) { return Math.floor(((time === undefined ? Date.now() : time) / 1000 + 8 * 3600) / 86400); }
function todayText(time) { return new Date((time === undefined ? Date.now() : time) + 8 * 3600000).toISOString().slice(0, 10); }

function signedToday(state, day) {
  return !!state && ["ok", "ignore"].indexOf(state.state) >= 0 &&
    (typeof state.signed_date === "number" || typeof state.signed_date === "string" && /^\d+$/.test(state.signed_date)) && Number(state.signed_date) === day;
}

function remaining() { return deadline - Date.now(); }

function pause(ms) {
  if (remaining() < ms + 1000) return Promise.reject(failure("budget", "执行时间不足，结果待确认。"));
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function timedFetch(options) {
  const timeout = Math.min(REQUEST_TIMEOUT_MS, remaining());
  if (timeout < 500 || finished) return Promise.reject(failure("budget", "执行时间不足，结果待确认。"));
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(failure("network", "请求失败或超时，请在 App 核对后重试。"));
    }, timeout);
    function complete(error, response) {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      if (error) reject(failure("network", "请求失败或超时，请在 App 核对后重试。"));
      else resolve(response);
    }
    Promise.resolve().then(function () { return $task.fetch(options); }).then(function (response) { complete(null, response); }, function () { complete(true); });
  });
}

function queryString(params) {
  return Object.keys(params).map(function (key) { return key + "=" + encodeURIComponent(params[key]).replace(/%2F/g, "/"); }).join("&");
}

function isAuth(body) {
  return /^(?:relogin|not_login|login_required|unauthorized)$/i.test(String(body.status || "")) ||
    /relogin|重新登录|未登录|请登录|登录(?:已)?(?:过期|失效)|(?:token|cookie)\s*(?:已)?(?:失效|过期|无效)/i.test(String(body.msg || ""));
}

async function requestJson(path, params, headers) {
  const response = await timedFetch({ url: API_BASE + path + "?" + queryString(params), method: "GET", headers: headers,
    opts: { redirection: false, "auto-cookie": false } });
  const status = Number(response && response.statusCode);
  if (status === 401 || status === 403) throw failure("auth", "登录凭据已失效，请重新抓取。");
  if (status === 429) throw failure("limit", "接口限流，请稍后再试。");
  if (status < 200 || status >= 300 || !Number.isFinite(status)) {
    const error = failure("http", "接口 HTTP 异常，请稍后核对。"); error.httpStatus = status; throw error;
  }
  const raw = String(response.body || "").trim();
  if (!raw || raw.length > 524288) throw failure("format", "响应格式异常，请核对 App 状态。");
  let body;
  try {
    const json = raw.charAt(0) === "{" ? raw : /^[A-Za-z0-9+/]+={0,2}$/.test(raw) ? b64decode(raw) : "";
    body = JSON.parse(json);
  } catch (error) { throw failure("format", "响应格式异常，请核对 App 状态。"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("format", "响应结构异常，请核对 App 状态。");
  if (isAuth(body)) throw failure("auth", "登录凭据已失效，请重新抓取。");
  if (body.status !== "ok") {
    const error = failure("business", "接口拒绝请求，请在 App 核对；接口版本可能已变化。");
    error.already = /今日已签到|今天已签到|重复签到/.test(String(body.msg || ""));
    throw error;
  }
  if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) throw failure("format", "响应结果缺失，请核对 App 状态。");
  return body.result;
}

async function nativeGet(profile, path, withRnd) {
  const params = {};
  PARAM_KEYS.forEach(function (key) { if (profile.params[key] !== undefined) params[key] = profile.params[key]; });
  const time = String(Math.floor(Date.now() / 1000));
  params._time = time;
  params.nonce = genNonce(time);
  params.hkey = queryHkey(path, time, params.device_id, params.version, params.nonce);
  if (withRnd) params._rnd = genRnd(path, time, params.device_id, params.heybox_id, params.os_version, params.version);
  const url = API_BASE + path + "?" + queryString(params);
  let cookie = "pkey=" + profile.pkey + "; hkey=" + cookieHkey(url);
  if (profile.tokenid) cookie += "; x_xhh_tokenid=" + profile.tokenid;
  return requestJson(path, params, { accept: "*/*", referer: "http://api.maxjia.com/", "user-agent": profile.userAgent, cookie: cookie });
}

// Web 签名改写自 Cansiny0320/heybox-daily（原始算法作者 XiaHouSheng，MIT）。
function webSignature(path, time, nonce) {
  const alphabet = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";
  function map(text, chars) { return Array.from(text).map(function (c) { return chars[c.charCodeAt(0) % chars.length]; }).join(""); }
  function double(n) { return n & 128 ? ((n << 1) ^ 27) & 255 : n << 1; }
  function triple(n) { return double(n) ^ n; }
  function k(n) { return triple(double(n)); }
  function c(n) { return k(triple(double(n))); }
  function s(n) { return c(n) ^ k(n) ^ triple(n); }
  const normalized = "/" + path.split("/").filter(Boolean).join("/") + "/";
  const parts = [map(String(time + 1), alphabet.slice(0, -2)), map(normalized, alphabet), map(nonce, alphabet)];
  let mixed = "";
  const length = Math.max.apply(null, parts.map(function (part) { return part.length; }));
  for (let i = 0; i < length; i++) parts.forEach(function (part) { mixed += part[i] || ""; });
  const digest = md5hex(utf8Bytes(mixed.slice(0, 20)));
  const input = Array.from(digest.slice(-6)).map(function (char) { return char.charCodeAt(0); });
  const transforms = [s, c, k, triple];
  let total = input[4] + input[5];
  for (let row = 0; row < 4; row++) {
    let value = 0;
    for (let col = 0; col < 4; col++) value ^= transforms[(col - row + 4) % 4](input[col]);
    total += value;
  }
  return { hkey: map(digest.slice(0, 5), alphabet.slice(0, -4)) + String(total % 100).padStart(2, "0"), _time: String(time), nonce: nonce };
}

async function rewardHistory(profile, day) {
  const unavailable = { available: false, confirmed: false, coin: 0 };
  if (remaining() < 1000) return unavailable;
  const time = Math.floor(Date.now() / 1000);
  const nonce = md5hex(utf8Bytes(String(Date.now()) + ":" + String(Math.random()))).toUpperCase();
  const signature = webSignature("/store/hcoin/history/", time, nonce);
  const params = { app: "heybox", os_type: "web", x_app: "heybox", x_client_type: "web", x_os_type: profile.params.os_type || profile.params.x_os_type,
    x_client_version: profile.params.version, version: "999.0.4", heybox_id: profile.params.heybox_id, offset: "0", limit: "30",
    hkey: signature.hkey, _time: signature._time, nonce: signature.nonce };
  let cookie = "pkey=" + profile.pkey + "; x_pkey=" + profile.pkey + "; x_heybox_id=" + profile.params.heybox_id;
  if (profile.tokenid) cookie += "; x_xhh_tokenid=" + profile.tokenid;
  try {
    const result = await requestJson("/store/hcoin/history/", params, { accept: "application/json, text/plain, */*", origin: "https://web.xiaoheihe.cn",
      referer: "https://web.xiaoheihe.cn/", "user-agent": profile.userAgent, cookie: cookie });
    if (!Array.isArray(result.history)) return unavailable;
    let coin = 0;
    for (const row of result.history.slice(0, 30)) {
      if (!row || row.event_desc !== "完成签到任务" || row.type !== "inc" || typeof row.timestamp !== "string" ||
          !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(row.timestamp) || row.timestamp.slice(0, 10) !== day) continue;
      const value = typeof row.value === "number" || typeof row.value === "string" && /^\d+$/.test(row.value) ? Number(row.value) : NaN;
      if (Number.isSafeInteger(value) && value > 0) coin += value;
    }
    return { available: true, confirmed: coin > 0, coin: coin, limited: result.history.length >= 30 };
  } catch (error) {
    // 钱包查询只辅助确认奖励；失败不能推翻已经确认的签到状态，也不能声称奖励到账。
    console.log("[小黑盒] 奖励流水暂不可核验（" + (error.kind || "unknown") + "）。");
    return unavailable;
  }
}

function report(profile, status, title, message, signed, reward, day) {
  const result = { version: SCRIPT_VERSION, account: profileId(profile), date: day, checkedAt: new Date().toISOString(),
    status: status, signed: signed, rewardConfirmed: !!(reward && reward.confirmed), coin: reward && reward.confirmed ? reward.coin : null, message: message };
  let stored = false;
  try {
    const latest = JSON.parse($prefs.valueForKey(STORE_PROFILE) || "null");
    if (latest && latest.params && profileId(latest) === result.account) stored = $prefs.setValueForKey(JSON.stringify(result), STORE_STATUS);
  } catch (error) { /* 不覆盖执行期间切换到另一个账号后的状态。 */ }
  if (!stored) console.log("[小黑盒] 本次结果未写入本地状态，请以通知和 App 为准。");
  $notify(SCRIPT_NAME, title, message);
}

async function runTask() {
  deadline = Date.now() + TASK_BUDGET_MS;
  const raw = $prefs.valueForKey(STORE_PROFILE);
  if (!raw) { $notify(SCRIPT_NAME, "尚未获取参数", "请开启抓取规则，登录小黑盒并进入“我的 → 签到”。"); return; }
  let profile;
  try { profile = validateProfile(JSON.parse(raw)); }
  catch (error) { $notify(SCRIPT_NAME, "本地参数无效", "请重新抓取完整的 iOS 小黑盒签到页请求。"); return; }
  const day = todayText();
  const number = todayNumber();
  let submitted = false;
  try {
    let state = await nativeGet(profile, profile.statePath, false);
    let reward = await rewardHistory(profile, day);
    if (todayNumber() !== number) throw failure("budget", "执行跨过北京时间零点，请核对后重新运行。");
    if (signedToday(state, number) || reward.confirmed) {
      const text = reward.confirmed ? "今日签到已确认，签到流水入账 +" + reward.coin + " H 币。" : "今日签到状态已确认；奖励流水尚未确认，请在 App 核对。";
      report(profile, "already", "今日已签到", text + "本次未重复提交。", true, reward, day);
      return;
    }
    if (["ok", "ignore", "waiting", ""].indexOf(state.state) < 0 ||
        ["ok", "ignore"].indexOf(state.state) >= 0 && (state.signed_date === undefined || state.signed_date === null || state.signed_date === "")) {
      report(profile, "pending", "结果待确认", "状态缺少可核对的当日信息，未提交签到；请在 App 核对。", false, reward, day);
      return;
    }
    submitted = true;
    try { await nativeGet(profile, "/task/sign_v3/sign", true); }
    catch (error) {
      if (error.kind !== "network" && !(error.kind === "http" && error.httpStatus >= 500) && !error.already) throw error;
      console.log("[小黑盒] 提交结果不确定，仅查询状态，不重复提交。");
    }
    let signed = false;
    for (const delay of POLL_DELAYS_MS) {
      if (remaining() < delay + 1000 || todayNumber() !== number) break;
      await pause(delay);
      try { state = await nativeGet(profile, profile.statePath, false); }
      catch (error) {
        if (["network", "http", "format"].indexOf(error.kind) < 0) throw error;
        continue;
      }
      if (signedToday(state, number)) { signed = true; break; }
    }
    reward = await rewardHistory(profile, day);
    if (todayNumber() !== number) {
      report(profile, "pending", "结果待确认", "执行跨过北京时间零点，请在 App 核对；本次不再提交。", false, null, day);
    } else if (reward.confirmed) {
      report(profile, "confirmed", "签到成功 ✅", "今日签到流水已确认入账 +" + reward.coin + " H 币。", true, reward, day);
    } else {
      report(profile, "pending", signed ? "已签到，奖励待确认" : "签到结果待确认", signed
        ? "今日签到状态已确认，但未核实奖励入账；请在 App 钱包明细核对。"
        : "请求已提交一次，尚未确认今日签到及奖励；请在 App 核对后再运行。", signed, reward, day);
    }
  } catch (error) {
    const kind = error.kind || "unknown";
    console.log("[小黑盒] 任务结束（" + kind + "），未输出请求或凭据。");
    const uncertain = submitted && ["network", "budget", "http", "format"].indexOf(kind) >= 0;
    const message = kind === "auth" ? "登录凭据已失效，请重新进入签到页抓取。" : kind === "limit" ? "接口限流，请稍后核对 App，不要连续运行。"
      : uncertain ? "提交后未能完成核验，请在 App 核对；本次不重复提交。" : "未能完成签到核验，请核对 App；必要时重新抓取当前版本参数。";
    report(profile, kind === "auth" ? "auth" : uncertain || kind === "budget" ? "pending" : "fail", kind === "auth" ? "登录失效" : uncertain || kind === "budget" ? "结果待确认" : "签到未完成", message, false, null, day);
  }
}

// iOS 签名及纯 JS 原语：MaYIHEI/paperclip @ f320e2ac (MIT)，保留原算法。
const NONCE_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function genNonce(time) {
  const d = new Date(Number(time) * 1000);
  const seed =
    d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const daily = [];
  for (let i = 0; i < 32; i++) daily.push(NONCE_ALPHABET[(seed + 267 + 7 * i) % 62]);
  let out = "";
  for (let i = 0; i < 32; i++) out += daily[Math.floor(Math.random() * daily.length)];
  return out;
}

// _rnd: 签到接口的 RNDCode v14。取 5 项输入(path/time/device_id+heybox_id/os_version/version),
// 各按 C 字符串在首个 NUL 截断,经 eE2/eE3 字节变换 + QuickJS 解码 → 取 UTF-16 低字节,
// 再做魔改 SHA-512 的 HMAC(H14),摘要转小写 hex 后过自定义 CRC32,格式 "14:大写无前导零 hex"。
function genRnd(path, time, deviceId, heyboxId, osVersion, version) {
  const P = bridgeNul(path.endsWith("/") ? path : path + "/");
  const T = bridgeNul(String(time));
  const I = bridgeNul(String(deviceId) + String(heyboxId));
  const O = bridgeNul(String(osVersion));
  const V = bridgeNul(String(version));
  const key = utf16Low(eE(P + T, 2));
  const data = utf16Low(eE(I + O + V, 3));
  const crc = crc14(asciiBytes(hexLower(hmac14(key, data))));
  return "14:" + crc.toString(16).toUpperCase();
}

function bridgeNul(s) { const i = s.indexOf("\0"); return i < 0 ? s : s.slice(0, i); }
function asciiBytes(s) { const o = []; for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 255); return o; }
function hexLower(bytes) { let s = ""; for (const b of bytes) s += b.toString(16).padStart(2, "0"); return s; }
function utf16Low(str) { const o = new Array(str.length); for (let i = 0; i < str.length; i++) o[i] = str.charCodeAt(i) & 255; return o; }

// eE2/eE3: signed 字节 + C 截断取模 + 127 字节上限,输出再按这版 QuickJS 的 JS_NewString 解码
function eE(text, which) { return quickjsDecode(transformStage(utf8Bytes(text), which)); }
function signedMod128(v) { return v >= 0 ? (v & 127) : -((-v) & 127); }
function stage(data, key, shift, period) {
  const out = new Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const c = data[i] < 128 ? data[i] : data[i] - 256;
    const plain = signedMod128(c ^ key);
    const altered = signedMod128((c << shift) ^ key);
    out[i] = (((i + 1) % period === 0 || plain === 0) ? altered : plain) & 255;
  }
  return out;
}
function transformStage(bytes, which) {
  const nul = bytes.indexOf(0);
  let d = (nul >= 0 ? bytes.slice(0, nul) : bytes).slice(0, 127);
  d = stage(d, 0x37, 4, 3);
  return which === 2 ? d : stage(d, 0x46, 2, 5);
}
function quickjsDecode(data) {
  let out = "", i = 0;
  const MIN = [0x80, 0x800, 0x10000, 0x200000, 0x4000000];
  while (i < data.length) {
    const c = data[i];
    if (c < 128) { out += String.fromCharCode(c); i++; continue; }
    const count = c < 0xe0 ? 2 : c < 0xf0 ? 3 : c < 0xf8 ? 4 : c < 0xfc ? 5 : 6;
    let value = c & (0x7f >> count);
    let valid = c >= 0xc0 && c <= 0xfd && i + count <= data.length;
    if (valid) {
      for (let j = i + 1; j < i + count; j++) {
        const b = data[j];
        if (!(b >= 0x80 && b < 0xc0)) { valid = false; break; }
        value = (value << 6) | (b & 63);
      }
      valid = valid && MIN[count - 2] <= value && value < 0x110000;
    }
    if (valid) { out += String.fromCodePoint(value); i += count; }
    else {
      while (i < data.length && data[i] >= 0x80 && data[i] < 0xc0) i++;
      if (i < data.length) i++;
      while (i < data.length && data[i] >= 0x80 && data[i] < 0xc0) i++;
      out += "�";
    }
  }
  return out;
}

// 魔改 SHA-512(H14): Σ0=ROTR21^31^39、σ1=ROTR38^55^SHR6、Ch=(x&(y^z))^y、K[60..79] 与 pad 均改
const H14_K = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x7ba0ea2d98160007n, 0x7eabf2d0c21f964an, 0x8dbe8d038b409545n, 0x90bb1721582e8285n,
  0x99a2ad45936d4e61n, 0x9f86e289fe03e73an, 0xa84c4472faa9a82fn, 0xb3df34fce89e0532n,
  0xb99bb8d7b173534fn, 0xbc76cbab1aea1f9cn, 0xc226a69a780f3cc3n, 0xd304f19aa233957dn,
  0xde1be20a212129ddn, 0xe39bb43755141950n, 0xee84927cea48ddd2n, 0xf3edd2773c523b67n,
  0xfbfdfe53a8d32f2an, 0x0bee2c7ab77e9e25n, 0x0e90181cf1b09e56n, 0x25f57204c725bed8n,
];
const H14_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const M64 = (1n << 64n) - 1n;
function rotr64(x, n) { const b = BigInt(n); return ((x >> b) | (x << (64n - b))) & M64; }
function h14digest(bytes) {
  const data = bytes.slice();
  const bitLen = BigInt(data.length * 8);
  data.push(0x80);
  while (data.length % 128 !== 112) data.push(0);
  for (let i = 15; i >= 0; i--) data.push(Number((bitLen >> BigInt(8 * i)) & 0xffn));
  let [a0, b0, c0, d0, e0, f0, g0, h0] = H14_IV;
  for (let off = 0; off < data.length; off += 128) {
    const w = [];
    for (let i = 0; i < 16; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane = (lane << 8n) | BigInt(data[off + i * 8 + b]);
      w.push(lane);
    }
    for (let i = 16; i < 80; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr64(x, 1) ^ rotr64(x, 8) ^ (x >> 7n);
      const s1 = rotr64(y, 38) ^ rotr64(y, 55) ^ (y >> 6n);
      w.push((s1 + w[i - 7] + s0 + w[i - 16]) & M64);
    }
    let a = a0, b = b0, c = c0, d = d0, e = e0, f = f0, g = g0, h = h0;
    for (let i = 0; i < 80; i++) {
      const sigma1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & (f ^ g)) ^ f;
      const t1 = (h + sigma1 + ch + H14_K[i] + w[i]) & M64;
      const sigma0 = rotr64(a, 21) ^ rotr64(a, 31) ^ rotr64(a, 39);
      const maj = (a & (b | c)) | (b & c);
      const t2 = (sigma0 + maj) & M64;
      h = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
    }
    a0 = (a0 + a) & M64; b0 = (b0 + b) & M64; c0 = (c0 + c) & M64; d0 = (d0 + d) & M64;
    e0 = (e0 + e) & M64; f0 = (f0 + f) & M64; g0 = (g0 + g) & M64; h0 = (h0 + h) & M64;
  }
  const out = [];
  for (const v of [a0, b0, c0, d0, e0, f0, g0, h0])
    for (let b = 7; b >= 0; b--) out.push(Number((v >> BigInt(8 * b)) & 0xffn));
  return out;
}
function hmac14(key, data) {
  let k = key.slice();
  if (k.length > 128) k = h14digest(k);
  while (k.length < 128) k.push(0);
  const inner = k.map((x) => x ^ 0x52);
  const outer = k.map((x) => x ^ 0x6c);
  return h14digest(outer.concat(h14digest(inner.concat(data))));
}

// 外层 CRC32: reflected poly 0xAD350290, init=xorout=0xFFFFFFFF(与查询 hkey 的 CRC 不同)
function crc14(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = ((crc >>> 1) ^ ((crc & 1) ? 0xad350290 : 0)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function queryHkey(path, time, deviceId, version, nonce) {
  if (!path.endsWith("/")) path += "/";
  const A = base64(hmacSha3_512(utf8Bytes(deviceId), utf8Bytes(version + "/" + time)));
  const B = base64(hmacSha3_512(utf8Bytes(A), utf8Bytes(path + "+" + time + "+" + deviceId + "+" + nonce)));
  return hex8(crc32Custom(utf8Bytes(A + B)));
}

function cookieHkey(finalUrl) {
  const inner = md5hex(utf8Bytes(finalUrl));
  return md5hex(utf8Bytes(inner.replace(/a/g, "a1")));
}


function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64CHARS[b0 >> 2];
    out += B64CHARS[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined ? "=" : B64CHARS[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? "=" : B64CHARS[b2 & 63];
  }
  return out;
}
function b64decode(str) {
  str = String(str).replace(/[^A-Za-z0-9+/=]/g, "");
  let bytes = [];
  for (let i = 0; i < str.length; i += 4) {
    const e = [0, 1, 2, 3].map((j) => B64CHARS.indexOf(str[i + j] || "="));
    const n = (e[0] << 18) | (e[1] << 12) | ((e[2] & 63) << 6) | (e[3] & 63);
    bytes.push((n >> 16) & 0xff);
    if (str[i + 2] !== "=" && e[2] !== -1) bytes.push((n >> 8) & 0xff);
    if (str[i + 3] !== "=" && e[3] !== -1) bytes.push(n & 0xff);
  }
  // bytes → UTF-8 string
  let out = "", i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
    }
  }
  return out;
}

// SHA3-512 (FIPS 202, Keccak-f[1600], rate 72B, domain 0x06) via BigInt
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const KMASK = (1n << 64n) - 1n;
function rotl(x, n) { n = BigInt(n); return ((x << n) | (x >> (64n - n))) & KMASK; }
function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = (B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y]) & B[((x + 2) % 5) + 5 * y])) & KMASK;
    s[0] ^= RC[round];
  }
}
function sha3_512(bytes) {
  const rate = 72;
  const s = new Array(25).fill(0n);
  const msg = bytes.slice();
  msg.push(0x06);
  while (msg.length % rate !== 0) msg.push(0x00);
  msg[msg.length - 1] |= 0x80;
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate; i += 8) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(msg[off + i + b]) << BigInt(8 * b);
      s[i / 8] ^= lane;
    }
    keccakF(s);
  }
  const out = [];
  let laneIdx = 0;
  while (out.length < 64) {
    let lane = s[laneIdx++];
    for (let b = 0; b < 8 && out.length < 64; b++) { out.push(Number(lane & 0xffn)); lane >>= 8n; }
  }
  return out;
}
function hmacSha3_512(keyBytes, msgBytes) {
  const B = 72;
  let k = keyBytes.slice();
  if (k.length > B) k = sha3_512(k);
  while (k.length < B) k.push(0);
  const ipad = new Array(B), opad = new Array(B);
  for (let i = 0; i < B; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
  return sha3_512(opad.concat(sha3_512(ipad.concat(msgBytes))));
}

function crc32Custom(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xe5a623e0 : 0);
    crc = crc >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function hex8(n) { return (n >>> 0).toString(16).padStart(8, "0"); }

function md5hex(bytes) {
  const add = (a, b) => (a + b) & 0xffffffff;
  const rol = (x, c) => (x << c) | (x >>> (32 - c));
  const s = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) & 0xffffffff;
  const msg = bytes.slice();
  const lenBits = msg.length * 8;
  msg.push(0x80);
  while (msg.length % 64 !== 56) msg.push(0);
  for (let i = 0; i < 8; i++) msg.push((lenBits / Math.pow(2, 8 * i)) & 0xff);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < msg.length; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) M[i] = msg[off + i * 4] | (msg[off + i * 4 + 1] << 8) | (msg[off + i * 4 + 2] << 16) | (msg[off + i * 4 + 3] << 24);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = add(add(add(F, A), K[i]), M[g]);
      A = D; D = C; C = B;
      B = add(B, rol(F, s[i]));
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  const toHex = (n) => { let h = ""; for (let i = 0; i < 4; i++) h += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, "0"); return h; };
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

// 保留当天带奖励的旧记录(状态、奖励文字、时间),合并本次拿到的资产、过期时间等;本次没有的沿用旧值


// 入口放在密码学常量初始化之后；抓取只保存参数，不主动请求签到。
(async function () {
  console.log("[小黑盒] 脚本版本 " + SCRIPT_VERSION);
  try {
    if (typeof $request !== "undefined") captureProfile();
    else await runTask();
  } catch (error) {
    $notify(SCRIPT_NAME, "参数获取失败", "请确认请求包含完整 iOS 登录和设备参数，且本机存储可写。");
  } finally { finish(); }
})();
