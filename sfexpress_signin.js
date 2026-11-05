/**
 * 顺丰速运 App / 微信小程序每日签到（Quantumult X）
 * Copyright (c) 2026 d539834401
 * Version: 20261105.1
 *
 * 依据公开协议独立实现，未复制第三方脚本源码：
 * https://github.com/yang7758258/ohhh_QL-Script/tree/74fba0ca5619a4ec074492ceb7a8a7a2ca2facbc
 * https://github.com/haoyu592/DSbox/tree/6bc18d90cf05c30bb39b4bb638cc443594790474
 * 以及 2026-11-05 顺丰官方 superWelfare 页和前端静态资源。
 *
 * 合并 sfexpress_signin.conf，打开顺丰 App/「顺丰速运」小程序的积分、签到页。
 * 单文件抓取/定时双模式；抓取不主动请求签到。凭据仅存本机 $prefs。
 * 新版日历先查后签再查；普通签到是独立活动，不作为失败后的重试通道。
 * 只处理两项每日签到及普通签到待领礼包，不处理寄件、浏览任务或其它活动。
 * 离线模拟 QX 测试通过，尚未使用真实账号在 iPhone/QX 验证。
 */

const SCRIPT_NAME = "顺丰速运签到";
const SCRIPT_VERSION = "20261105.1";
const PROFILE_KEY = "sfexpress_signin_profile_v1";
const STATUS_KEY = "sfexpress_signin_status_v1";
const BASE = "https://mcs-mimp-web.sf-express.com";
const PREFIX = "/mcs-mimp/commonPost/";
const ENDPOINTS = {
  login: "/mcs-mimp/ifLogin",
  today: PREFIX + "~memberNonactivity~integralSignV2Service~getTodaySign",
  sign: PREFIX + "~memberNonactivity~integralSignV2Service~sign",
  ordinary: PREFIX + "~memberNonactivity~integralTaskSignPlusService~automaticSignFetchPackage",
  claim: PREFIX + "~memberNonactivity~integralTaskSignPlusService~getUnFetchPointAndDiscount",
  points: PREFIX + "~memberIntegral~userInfoService~queryUserInfo"
};
const CAPTURE = /^https:\/\/mcs-mimp-web\.sf-express\.com\/mcs-mimp\/(?:ifLogin|commonPost\/~memberNonactivity~(?:integralSignV2Service~(?:getTodaySign|sign)|integralTaskSignPlusService~(?:automaticSignFetchPackage|getUnFetchPointAndDiscount)|integralTaskStrategyService~queryPointTaskAndSignFromES)|commonPost\/~memberIntegral~userInfoService~(?:queryUserInfo|personalInfoNew))(?:\?[^#\s]*)?$/;
const TASK_MS = 45000;
const REQUEST_MS = 5500;
let deadline = 0;
let finished = false;

function finish() { if (!finished) { finished = true; $done({}); } }
function object(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function parseObject(text) { try { const v = JSON.parse(text); return object(v) ? v : null; } catch (_) { return null; } }
function failure(kind, message) { const e = new Error(message); e.kind = kind; return e; }
function day() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function cleanHeader(value) { return typeof value === "string" && !/[\r\n\0]/.test(value) ? value.trim() : ""; }
function header(headers, name) {
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i += 1) if (keys[i].toLowerCase() === name.toLowerCase()) return headers[keys[i]];
  return "";
}
function cookieMap(raw, setCookie) {
  const result = Object.create(null);
  (Array.isArray(raw) ? raw : [raw]).forEach(function (value) {
    String(value || "").split(/,(?=\s*[^=;,\s]+=)/).forEach(function (line) {
      line.split(";").forEach(function (piece) {
        const match = piece.trim().match(/^([a-z0-9_-]+)=([^;\s,\r\n]*)$/i);
        if (!match || (setCookie && /^(?:path|domain|expires|max-age|samesite|priority)$/i.test(match[1]))) return;
        result[match[1]] = match[2];
      });
    });
  });
  return result;
}
function cookieString(cookies) { return Object.keys(cookies).map(function (k) { return k + "=" + cookies[k]; }).join("; "); }
function sessionId(cookies) { return cookies.sessionId || cookies.JSESSIONID || ""; }
function validCookie(cookie) {
  if (!cleanHeader(cookie)) return false;
  const id = sessionId(cookieMap(cookie));
  return /^[a-z0-9._~%+-]{8,512}$/i.test(id) && !/^(?:undefined|null)$/i.test(id);
}
function validProfile(profile) {
  return object(profile) && profile.version === 1 && validCookie(profile.cookie) && !!cleanHeader(profile.userAgent) &&
    /^(?:MINI_PROGRAM|SFAPP|WEIXIN)$/.test(profile.platform) && /^[a-z0-9_-]{1,64}$/i.test(profile.channel) &&
    (profile.deviceId === undefined || /^[a-z0-9_-]{1,128}$/i.test(profile.deviceId));
}

function capture() {
  if (!CAPTURE.test(String($request.url || "")) || String($request.method || "GET").toUpperCase() === "OPTIONS") return;
  const cookie = cleanHeader(header($request.headers, "cookie"));
  const userAgent = cleanHeader(header($request.headers, "user-agent"));
  if (!validCookie(cookie) || !userAgent) {
    console.log("[顺丰] 请求已命中，但缺少完整会话；请登录后进入积分或签到页面。");
    return;
  }
  const rawPlatform = cleanHeader(header($request.headers, "platform")).toUpperCase();
  const platform = /^(?:MINI_PROGRAM|SFAPP|WEIXIN)$/.test(rawPlatform) ? rawPlatform : /MicroMessenger|miniProgram/i.test(userAgent) ? "MINI_PROGRAM" : "SFAPP";
  const channel = cleanHeader(header($request.headers, "channel")) || (platform === "SFAPP" ? "appqiandao" : "mypoint");
  const device = cleanHeader(header($request.headers, "deviceid"));
  const profile = { version: 1, cookie: cookieString(cookieMap(cookie)), userAgent: userAgent, platform: platform, channel: channel };
  if (device && /^[a-z0-9_-]{1,128}$/i.test(device)) profile.deviceId = device;
  if (!validProfile(profile)) throw failure("capture", "会话参数格式不完整，请重新打开积分页抓取。");
  const old = parseObject($prefs.valueForKey(PROFILE_KEY));
  if (JSON.stringify(old) === JSON.stringify(profile)) return;
  if (!$prefs.setValueForKey(JSON.stringify(profile), PROFILE_KEY)) throw failure("storage", "本机凭据保存失败，请检查 QX 存储后重新抓取。");
  $notify(SCRIPT_NAME, "参数获取成功 ✅", "已保存到本机，请关闭抓取规则，再手动运行顺丰签到任务。");
}

function loadAccount() {
  const raw = $prefs.valueForKey(PROFILE_KEY) || "";
  const profile = parseObject(raw);
  if (!validProfile(profile)) throw failure("config", "请开启抓取规则，登录顺丰 App 或「顺丰速运」小程序后进入积分、签到页。");
  return { profile: profile, snapshot: raw };
}
function unchanged(account) { return ($prefs.valueForKey(PROFILE_KEY) || "") === account.snapshot; }
function guard(account) { if (!unchanged(account)) throw failure("changed", "运行期间登录参数已变化，请使用新参数重新运行。"); }

function rotateCookies(account, response) {
  const fresh = cookieMap(header(response.headers, "set-cookie"), true);
  if (!Object.keys(fresh).length) return;
  const current = cookieMap(account.profile.cookie);
  const primary = current.sessionId ? "sessionId" : "JSESSIONID";
  if (Object.prototype.hasOwnProperty.call(fresh, primary) && !fresh[primary]) throw failure("auth", "服务端已撤销登录会话，请重新登录并抓取。");
  for (const key of ["_login_user_id_", "_login_mobile_"]) {
    if (fresh[key] && current[key] && fresh[key] !== current[key]) throw failure("changed", "服务端返回不同账号的会话，请重新抓取本人登录参数。");
  }
  Object.keys(fresh).forEach(function (key) { current[key] = fresh[key]; });
  const cookie = cookieString(current);
  if (cookie === account.profile.cookie) return;
  if (!validCookie(cookie)) throw failure("auth", "服务端已撤销登录会话，请重新登录并抓取。");
  guard(account);
  const profile = Object.assign({}, account.profile, { cookie: cookie });
  const raw = JSON.stringify(profile);
  if (!$prefs.setValueForKey(raw, PROFILE_KEY)) throw failure("storage", "服务器续发会话未能保存，请检查 QX 存储后重新抓取。");
  account.profile = profile;
  account.snapshot = raw;
}

function authError(body) {
  return String(body.errorCode) === "100111" || /用户信息失效|(?:重新|请先)登录|登录.{0,8}(?:过期|失效|超时)/.test(String(body.errorMessage || ""));
}
function apiHeaders(profile) {
  const time = String(Date.now());
  const h = { Cookie: profile.cookie, "User-Agent": profile.userAgent, Accept: "application/json, text/plain, */*", "Content-Type": "application/json",
    syscode: "MCS-MIMP-CORE", timestamp: time,
    signature: md5("token=wwesldfs29aniversaryvdld29&timestamp=" + time + "&sysCode=MCS-MIMP-CORE"),
    channel: profile.channel, platform: profile.platform, Origin: BASE, Referer: BASE + "/up-member/newPoints" };
  if (profile.deviceId) h.deviceid = profile.deviceId;
  return h;
}
function fetchResponse(options) {
  const timeout = Math.min(REQUEST_MS, deadline - Date.now());
  if (timeout < 800) return Promise.reject(failure("budget", "任务剩余时间不足，请稍后手动运行。"));
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (!settled) { settled = true; reject(failure("network", "请求超时，结果请在顺丰页面核对；本次不重发。")); }
    }, timeout);
    Promise.resolve().then(function () { return $task.fetch(options); }).then(function (response) {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      resolve(response);
    }, function () {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      reject(failure("network", "网络请求失败，结果请在顺丰页面核对；本次不重发。"));
    });
  });
}
async function api(account, key, body, duplicateAllowed) {
  guard(account);
  if (!Object.prototype.hasOwnProperty.call(ENDPOINTS, key)) throw failure("protocol", "未知接口，任务未继续执行。");
  const response = await fetchResponse({ url: BASE + ENDPOINTS[key], method: "POST", headers: apiHeaders(account.profile),
    body: JSON.stringify(body || {}), opts: { redirection: false, "auto-cookie": false } });
  const status = Number(response && response.statusCode);
  if (status === 401) throw failure("auth", "登录状态已过期，请重新打开顺丰积分页抓取会话。");
  if (status === 403) throw failure("denied", "服务端拒绝请求，请核对登录参数或在顺丰页面查看限制提示。");
  if (status === 429) throw failure("limited", "服务端限流，请稍后手动运行。");
  if (status >= 500) throw failure("server", "顺丰服务暂不可用，请稍后重试。");
  if (!(status >= 200 && status < 300)) throw failure("protocol", "接口返回异常 HTTP 状态，请在顺丰页面核对。");
  const data = parseObject(response.body);
  if (!data) throw failure("protocol", "接口未返回预期 JSON 对象，请稍后重试或检查协议更新。");
  if (authError(data)) throw failure("auth", "登录状态已过期，请重新打开顺丰积分页抓取会话。");
  if (duplicateAllowed && String(data.errorCode) === "3400002") {
    rotateCookies(account, response);
    return { duplicate: true };
  }
  if (data.success !== true) throw failure("business", "活动接口未确认成功，请在顺丰页面查看原因。");
  rotateCookies(account, response);
  return data;
}

function integer(value) { return /^(?:0|[1-9]\d{0,9})$/.test(String(value)) ? Number(value) : null; }
function boolean(value) { return value === true || value === 1 || value === "1" ? true : value === false || value === 0 || value === "0" ? false : null; }
function ensureDay(date) { if (day() !== date) throw failure("day", "任务跨越北京时间零点，请重新运行核对新一天状态。"); }
function beforeWrite(account, date, reserve) {
  guard(account); ensureDay(date);
  if (deadline - Date.now() < reserve) throw failure("budget", "剩余时间不足以执行并核验，请稍后重新运行。");
}
async function todayStatus(account) {
  const r = await api(account, "today", {});
  if (!object(r.obj) || boolean(r.obj.signed) === null) throw failure("protocol", "新版日历的当天状态无法识别，未自动提交签到。");
  return { signed: boolean(r.obj.signed), days: integer(r.obj.dayCount) };
}
function result(state, text) { return { state: state, text: text }; }
function countText(value, label) { const n = integer(value); return n === null ? "" : "，" + label + n + "天"; }
function stopError(error) { return ["auth", "changed", "storage", "day"].indexOf(error.kind) >= 0; }

async function calendarSign(account, date) {
  const before = await todayStatus(account);
  ensureDay(date);
  if (before.signed) return result("already", "今日已签到" + countText(before.days, "连续"));
  beforeWrite(account, date, REQUEST_MS + 1500);
  let submitError;
  try { await api(account, "sign", {}, true); }
  catch (error) { if (stopError(error)) throw error; submitError = error; }
  let after;
  try { after = await todayStatus(account); }
  catch (error) {
    if (stopError(error)) { error.afterSubmit = true; throw error; }
    return result("pending", "已提交但无法查询确认，请在顺丰页面核对；本次不重发");
  }
  ensureDay(date);
  if (after.signed) return result("signed", "已查询确认签到" + countText(after.days, "连续"));
  if (submitError && ["business", "denied", "limited", "protocol"].indexOf(submitError.kind) >= 0) return result("failed", submitError.message);
  return result("pending", "服务端尚未确认当日已签，请在顺丰页面核对；本次不重发");
}

async function ordinarySign(account, date) {
  beforeWrite(account, date, REQUEST_MS + 1000);
  const channelFrom = account.profile.platform === "SFAPP" ? "SFAPP" : "WEIXIN";
  let response;
  try { response = await api(account, "ordinary", { comeFrom: "vioin", channelFrom: channelFrom }); }
  catch (error) {
    if (stopError(error)) throw error;
    return result(["network", "server"].indexOf(error.kind) >= 0 ? "pending" : "failed", error.message);
  }
  ensureDay(date);
  const obj = response.obj;
  // 官方页面：0=本次签到；1=当天已签；2=签到后礼包待领取。不能用空礼包列表判断已签。
  const flag = object(obj) ? integer(obj.hasFinishSign) : null;
  if (flag !== 0 && flag !== 1 && flag !== 2) return result("pending", "接口成功但未提供可识别的签到标志，请在顺丰页面核对");
  const answer = result(flag === 1 ? "already" : "signed", (flag === 1 ? "今日已签到" : "签到接口已确认") + countText(obj.countDay, "接口累计"));
  if (flag === 2) {
    try {
      beforeWrite(account, date, 1500);
      const claimed = await api(account, "claim", {});
      ensureDay(date);
      answer.text += Array.isArray(claimed.obj) && claimed.obj.length ? "；接口返回" + claimed.obj.length + "项礼包，到账请在顺丰核对" : "；礼包到账情况请在顺丰核对";
    } catch (error) {
      if (error.kind === "changed" || error.kind === "day") throw error;
      answer.text += "；礼包领取未确认，请在顺丰页面领取，本次不重发";
    }
  } else if (Array.isArray(obj.integralTaskSignPackageVOList) && obj.integralTaskSignPackageVOList.length) {
    answer.text += "；接口返回" + obj.integralTaskSignPackageVOList.length + "项礼包，到账请在顺丰核对";
  }
  return answer;
}

async function points(account) {
  const r = await api(account, "points", { sysCode: "ESG-CEMP-CORE", optionalColumns: ["usablePoint", "cycleSub", "leavePoint"], token: "zeTLTYeG0bLetfRk" });
  return object(r.obj) ? integer(r.obj.usablePoint) : null;
}
async function optionalPoints(account) {
  try { return await points(account); }
  catch (error) { if (stopError(error)) throw error; return null; }
}

async function runTask() {
  deadline = Date.now() + TASK_MS;
  const date = day(), account = loadAccount();
  const probe = await api(account, "login", {});
  if (!object(probe.obj) || String(probe.obj.loginStatus) !== "1") throw failure("auth", "会话尚未登录，请登录顺丰后重新进入积分页抓取。");
  const cookies = cookieMap(account.profile.cookie);
  const mobile = probe.obj.mobile;
  if (/^1\d{10}$/.test(String(mobile)) && /^1\d{10}$/.test(cookies._login_mobile_ || "") && String(mobile) !== cookies._login_mobile_) {
    throw failure("changed", "服务端账号与抓取账号不一致，请重新抓取本人登录参数。");
  }
  const before = await optionalPoints(account);
  const outcomes = {};
  let stopped;
  for (const key of ["calendar", "ordinary"]) {
    if (stopped) { outcomes[key] = result("skipped", "前一步未能继续，本项尚未执行"); continue; }
    try { outcomes[key] = await (key === "calendar" ? calendarSign(account, date) : ordinarySign(account, date)); }
    catch (error) {
      outcomes[key] = result(error.afterSubmit ? "pending" : "failed", error.kind ? error.message : "执行异常，请在顺丰页面核对");
      if (stopError(error)) stopped = error;
    }
  }
  let after = null;
  if (!stopped && deadline - Date.now() >= 1000) {
    try { after = await optionalPoints(account); }
    catch (error) { stopped = error; }
  }
  const rows = ["新版日历：" + outcomes.calendar.text, "普通签到：" + outcomes.ordinary.text];
  if (after !== null) rows.push("当前可用积分：" + after + (before !== null ? "（本次查询变化 " + (after - before >= 0 ? "+" : "") + (after - before) + "，含期间其它操作）" : ""));
  else rows.push("积分余额未能核验，签到结果以各项状态为准。");
  if (stopped && rows.join(" ").indexOf(stopped.message) < 0) rows.push(stopped.message);
  const states = [outcomes.calendar.state, outcomes.ordinary.state];
  const confirmed = states.filter(function (s) { return s === "signed" || s === "already"; }).length;
  const title = stopped && stopped.kind === "changed" ? "运行期间参数已变化" : confirmed === 2 ? "两项签到已确认 ✅" : confirmed === 1 ? "部分签到已确认" : "签到尚未确认";
  if (unchanged(account)) $prefs.setValueForKey(JSON.stringify({ date: date, checkedAt: Date.now(), calendar: outcomes.calendar.state, ordinary: outcomes.ordinary.state }), STATUS_KEY);
  $notify(SCRIPT_NAME, title, rows.join("\n"));
}

// 复用本仓库中国移动脚本的 UTF-8 / MD5 原语，运行时没有外部代码依赖。
function utf8(text) {
  const encoded = encodeURIComponent(text), out = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === "%") { out.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(encoded.charCodeAt(i));
  }
  return out;
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
  console.log("[顺丰] 脚本版本 " + SCRIPT_VERSION);
  try { if (typeof $request !== "undefined") capture(); else await runTask(); }
  catch (error) { $notify(SCRIPT_NAME, typeof $request !== "undefined" ? "参数获取未完成" : "任务未完成", error.kind ? error.message : "执行异常，请核对本机参数或反馈脚本版本。原始响应未写入日志。"); }
  finally { finish(); }
})();
