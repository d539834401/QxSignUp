const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../sfexpress_signin.js"), "utf8");
const conf = fs.readFileSync(path.join(__dirname, "../sfexpress_signin.conf"), "utf8");
const PROFILE = "sfexpress_signin_profile_v1", STATUS = "sfexpress_signin_status_v1";
const BASE = "https://mcs-mimp-web.sf-express.com";
const PREFIX = BASE + "/mcs-mimp/commonPost/";
const URLS = {
  login: BASE + "/mcs-mimp/ifLogin",
  today: PREFIX + "~memberNonactivity~integralSignV2Service~getTodaySign",
  sign: PREFIX + "~memberNonactivity~integralSignV2Service~sign",
  ordinary: PREFIX + "~memberNonactivity~integralTaskSignPlusService~automaticSignFetchPackage",
  claim: PREFIX + "~memberNonactivity~integralTaskSignPlusService~getUnFetchPointAndDiscount",
  points: PREFIX + "~memberIntegral~userInfoService~queryUserInfo"
};
const TIME = Date.parse("2026-11-05T00:35:00Z");
const PHONE = "15100000000"; // 合成数据，不使用真实账号。
const COOKIE = "sessionId=fixture-session-private; JSESSIONID=fixture-jsession-private; _login_user_id_=fixture-user-private; _login_mobile_=" + PHONE;
const UA = "Mozilla/5.0 iPhone MicroMessenger/8.0 fixture-mini-program";
function profile(extra = {}) { return { version: 1, cookie: COOKIE, userAgent: UA, platform: "MINI_PROGRAM", channel: "mypoint", ...extra }; }
function prefs(extra = {}) { return { [PROFILE]: JSON.stringify(profile()), ...extra }; }
function response(body, statusCode = 200, headers = {}) { return { statusCode, headers, body: typeof body === "string" ? body : JSON.stringify(body) }; }
function ok(obj) { return response({ success: true, obj }); }
function today(signed, dayCount = 5) { return ok({ signed, dayCount }); }
function ordinary(flag = 0, extra = {}) { return ok({ hasFinishSign: flag, countDay: 2, integralTaskSignPackageVOList: [], ...extra }); }
function points(value = 100) { return ok({ usablePoint: value }); }
const loggedIn = () => ok({ loginStatus: 1, mobile: PHONE });
const expired = () => response({ success: false, errorCode: "100111", errorMessage: "用户信息失效" });

async function execute({ stored: initial = prefs(), request, responses = [], writable = true, timeoutFast = false } = {}) {
  const stored = { ...initial }, calls = [], notices = [], logs = [], timers = new Set();
  let clock = TIME, doneCount = 0, resolve, reject, unexpected;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const controls = { stored, advance(ms) { clock += ms; } };
  const context = vm.createContext({
    Date: Clock,
    console: { log: (...args) => logs.push(args.join(" ")) },
    $prefs: { valueForKey: key => stored[key] || "", setValueForKey: (value, key) => {
      if (!writable) return false;
      stored[key] = value;
      return true;
    } },
    $notify: (...args) => notices.push(args),
    $done: () => { doneCount += 1; resolve(); },
    $task: { fetch: async options => {
      calls.push(options);
      const next = responses[calls.length - 1];
      if (next === undefined) { unexpected = new Error("Unexpected request: " + options.url); throw unexpected; }
      if (next instanceof Error) throw next;
      return typeof next === "function" ? next(options, controls) : next;
    } },
    setTimeout: (callback, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); if (timeoutFast) clock += ms; callback(); }, timeoutFast ? 2 : ms);
      timers.add(timer); return timer;
    },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); }
  });
  if (request !== undefined) context.$request = request;
  const guard = setTimeout(() => reject(new Error("Script did not finish")), 1500);
  try {
    vm.runInContext(source, context, { timeout: 1000 });
    await completed;
    if (unexpected) throw unexpected;
    assert.equal(doneCount, 1);
    const output = JSON.stringify({ notices, logs });
    for (const secret of [PHONE, "fixture-session-private", "fixture-jsession-private", "fixture-user-private", "fixture-new-session", "fixture-other-user", "fixture-access-secret"]) {
      assert.ok(!output.includes(secret), "Credentials leaked to output");
    }
    for (const options of calls) {
      assert.ok(Object.values(URLS).includes(options.url));
      assert.equal(options.opts.redirection, false);
      assert.equal(options.opts["auto-cookie"], false);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.signature, crypto.createHash("md5").update("token=wwesldfs29aniversaryvdld29&timestamp=" + options.headers.timestamp + "&sysCode=MCS-MIMP-CORE").digest("hex"));
    }
    return { stored, calls, notices, logs, context, controls };
  } finally { clearTimeout(guard); timers.forEach(clearTimeout); }
}
function text(result) { return result.notices.map(n => n.slice(1).join(" ")).join("\n"); }
function state(result) { return JSON.parse(result.stored[STATUS]); }
function captureRequest(extra = {}) { return { method: "POST", url: URLS.today, headers: { Cookie: COOKIE, "User-Agent": UA, platform: "MINI_PROGRAM", channel: "mypoint" }, ...extra }; }

test("MD5 matches node:crypto, including Unicode and block boundaries", async () => {
  const r = await execute({ request: { method: "OPTIONS" } });
  for (const value of ["", "abc", "顺丰签到🙂", "a".repeat(56), "xyz".repeat(100)]) {
    assert.equal(vm.runInContext("md5(" + JSON.stringify(value) + ")", r.context), crypto.createHash("md5").update(value).digest("hex"));
  }
});

test("remote configuration matches supported capture URLs and rejects unrelated paths", () => {
  const rule = conf.split("\n").find(line => line.startsWith("^"));
  const regex = new RegExp(rule.split(" url ")[0]);
  for (const url of Object.values(URLS)) assert.ok(regex.test(url));
  for (const url of [URLS.today + "?from=sf", PREFIX + "~memberNonactivity~integralTaskStrategyService~queryPointTaskAndSignFromES"]) assert.ok(regex.test(url));
  for (const url of ["http://mcs-mimp-web.sf-express.com/mcs-mimp/ifLogin", URLS.today.replace("sf-express.com", "sf-express.com.evil.invalid"), BASE + "/mcs-mimp/order/create"]) assert.equal(regex.test(url), false);
  assert.ok(rule.endsWith("script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/master/sfexpress_signin.js"));
  assert.match(conf, /35 8 \* \* \* https:\/\/raw\.githubusercontent\.com\/d539834401\/QxSignUp\/master\/sfexpress_signin\.js/);
});

test("capture saves actual session and channel without making requests", async () => {
  const r = await execute({ stored: {}, request: captureRequest() });
  assert.equal(r.calls.length, 0);
  assert.match(text(r), /参数获取成功/);
  assert.equal(JSON.parse(r.stored[PROFILE]).cookie, COOKIE);
  assert.equal(JSON.parse(r.stored[PROFILE]).platform, "MINI_PROGRAM");
});

test("App capture keeps SFAPP platform, channel and real device ID", async () => {
  const r = await execute({ stored: {}, request: captureRequest({ headers: { cookie: COOKIE, "user-agent": "SFMainland/iOS fixture", platform: "SFAPP", channel: "appqiandao", deviceid: "fixture-device-123" } }) });
  const p = JSON.parse(r.stored[PROFILE]);
  assert.equal(p.platform, "SFAPP"); assert.equal(p.channel, "appqiandao"); assert.equal(p.deviceId, "fixture-device-123");
});

test("JSESSIONID-only capture is accepted and unchanged capture is quiet", async () => {
  const req = captureRequest({ headers: { Cookie: "JSESSIONID=fixture-jsession-private", "User-Agent": UA } });
  const first = await execute({ stored: {}, request: req });
  const next = await execute({ stored: first.stored, request: req });
  assert.equal(next.notices.length, 0);
  assert.equal(JSON.parse(next.stored[PROFILE]).channel, "mypoint");
});

test("account change replaces all captured fields without inheriting old device ID", async () => {
  const r = await execute({ stored: { [PROFILE]: JSON.stringify(profile({ deviceId: "old-device" })) }, request: captureRequest({ headers: { Cookie: "sessionId=fixture-other-session; _login_user_id_=fixture-other-user", "User-Agent": UA } }) });
  const p = JSON.parse(r.stored[PROFILE]);
  assert.equal(p.deviceId, undefined);
  assert.ok(!p.cookie.includes("fixture-user-private"));
});

for (const [label, request] of [
  ["OPTIONS", captureRequest({ method: "OPTIONS" })],
  ["unrelated API", captureRequest({ url: BASE + "/mcs-mimp/order/create" })],
  ["missing session", captureRequest({ headers: { Cookie: "_login_mobile_=" + PHONE, "User-Agent": UA } })],
  ["missing UA", captureRequest({ headers: { Cookie: COOKIE } })],
  ["header injection", captureRequest({ headers: { Cookie: COOKIE + "\r\nother: secret", "User-Agent": UA } })]
]) test("invalid capture preserves current profile: " + label, async () => {
  const stored = prefs(); const r = await execute({ stored, request });
  assert.equal(r.stored[PROFILE], stored[PROFILE]); assert.equal(r.calls.length, 0);
});

test("storage failure is reported and capture never triggers sign-in", async () => {
  const r = await execute({ stored: {}, request: captureRequest(), writable: false });
  assert.match(text(r), /保存失败/); assert.equal(r.calls.length, 0);
});
test("missing profile returns setup instructions without requests", async () => {
  const r = await execute({ stored: {} }); assert.equal(r.calls.length, 0); assert.match(text(r), /开启抓取规则/);
});
test("malformed locally edited device header is rejected before requests", async () => {
  const r = await execute({ stored: { [PROFILE]: JSON.stringify(profile({ deviceId: "bad\r\nheader" })) } });
  assert.equal(r.calls.length, 0); assert.match(text(r), /开启抓取规则/);
});

test("full task signs the calendar once, confirms it, and separately signs ordinary activity", async () => {
  const r = await execute({ responses: [loggedIn(), points(100), today(false), ok({}), today(true, 6), ordinary(0, { integralTaskSignPackageVOList: [{ packetName: "fixture-access-secret" }] }), points(101)] });
  assert.deepEqual(r.calls.map(c => c.url), [URLS.login, URLS.points, URLS.today, URLS.sign, URLS.today, URLS.ordinary, URLS.points]);
  assert.equal(state(r).calendar, "signed"); assert.equal(state(r).ordinary, "signed");
  assert.match(text(r), /两项签到已确认/); assert.match(text(r), /当前可用积分：101/);
  assert.deepEqual(JSON.parse(r.calls[5].body), { comeFrom: "vioin", channelFrom: "WEIXIN" });
});

test("already signed calendar is not submitted and ordinary activity is still handled", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(true), ordinary(1), points()] });
  assert.equal(state(r).calendar, "already"); assert.equal(state(r).ordinary, "already");
  assert.equal(r.calls.filter(c => c.url === URLS.sign).length, 0);
  assert.equal(r.calls.filter(c => c.url === URLS.ordinary).length, 1);
});

test("App ordinary sign uses the actual SFAPP channel", async () => {
  const r = await execute({ stored: { [PROFILE]: JSON.stringify(profile({ platform: "SFAPP", channel: "appqiandao", deviceId: "fixture-device" })) }, responses: [loggedIn(), points(), today(true), ordinary(0), points()] });
  assert.equal(JSON.parse(r.calls[3].body).channelFrom, "SFAPP");
  assert.ok(r.calls.every(c => c.headers.platform === "SFAPP" && c.headers.channel === "appqiandao" && c.headers.deviceid === "fixture-device"));
});

test("ordinary flag 2 claims pending free package once without another sign", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(true), ordinary(2), ok([{ packetName: "fixture-access-secret" }]), points()] });
  assert.equal(r.calls.filter(c => c.url === URLS.claim).length, 1);
  assert.match(text(r), /接口返回1项礼包/); assert.equal(state(r).ordinary, "signed");
});

test("a failed package claim does not erase the confirmed ordinary sign", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(true), ordinary(2), response({}, 503), points()] });
  assert.equal(state(r).ordinary, "signed"); assert.match(text(r), /礼包领取未确认/);
  assert.equal(r.calls.filter(c => c.url === URLS.claim).length, 1);
});

for (const obj of [{}, { hasFinishSign: 7 }, { hasFinishSign: 0.5 }]) test("SUCCESS with unknown ordinary state is pending: " + JSON.stringify(obj), async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(true), ok(obj), points()] });
  assert.equal(state(r).ordinary, "pending"); assert.match(text(r), /部分签到已确认/);
});

test("empty reward list alone does not prove ordinary activity was already signed", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(true), ok({ integralTaskSignPackageVOList: [] }), points()] });
  assert.equal(state(r).ordinary, "pending");
});

test("calendar SUCCESS without signed status is pending, not success", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(false), ok({}), today(false), ordinary(1), points()] });
  assert.equal(state(r).calendar, "pending"); assert.equal(r.calls.filter(c => c.url === URLS.sign).length, 1);
});

test("lost calendar response is reconciled by query without retrying either channel", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(false), new Error("fixture-access-secret"), today(true), ordinary(1), points()] });
  assert.equal(state(r).calendar, "signed"); assert.equal(r.calls.filter(c => c.url === URLS.sign).length, 1);
});

test("calendar duplicate code 3400002 is verified by a follow-up query", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(false), response({ success: false, errorCode: "3400002" }), today(true), ordinary(1), points()] });
  assert.equal(state(r).calendar, "signed"); assert.equal(r.calls.filter(c => c.url === URLS.sign).length, 1);
});

test("timed-out ordinary sign is pending and never falls back to calendar sign again", async () => {
  const r = await execute({ timeoutFast: true, responses: [loggedIn(), points(), today(true), () => new Promise(() => {}), points()] });
  assert.equal(state(r).ordinary, "pending"); assert.equal(r.calls.filter(c => c.url === URLS.ordinary).length, 1);
});

test("expired session stops before mutation", async () => {
  const r = await execute({ responses: [expired()] }); assert.equal(r.calls.length, 1); assert.match(text(r), /登录状态已过期/);
});
test("loginStatus zero stops before mutation", async () => {
  const r = await execute({ responses: [ok({ loginStatus: 0 })] }); assert.equal(r.calls.length, 1); assert.match(text(r), /尚未登录/);
});
test("probe account mismatch stops before mutation", async () => {
  const r = await execute({ responses: [ok({ loginStatus: 1, mobile: "15100000001" })] }); assert.equal(r.calls.length, 1); assert.match(text(r), /账号不一致/);
});

test("auth expiry during calendar verification skips ordinary sign", async () => {
  const r = await execute({ responses: [loggedIn(), points(), today(false), ok({}), expired()] });
  assert.equal(state(r).calendar, "pending"); assert.equal(state(r).ordinary, "skipped"); assert.equal(r.calls.length, 5);
});

for (const [label, value] of [["missing signed", {}], ["string truthiness", { signed: "false" }], ["null", null]]) {
  test("unknown calendar schema does not submit calendar sign: " + label, async () => {
    const r = await execute({ responses: [loggedIn(), points(), ok(value), ordinary(1), points()] });
    assert.equal(state(r).calendar, "failed"); assert.equal(r.calls.filter(c => c.url === URLS.sign).length, 0);
    assert.equal(state(r).ordinary, "already");
  });
}

for (const [label, bad, expected] of [
  ["HTML", response("<html>blocked</html>"), /JSON 对象/],
  ["JSON array", response([]), /JSON 对象/],
  ["HTTP 403", response({}, 403), /拒绝请求/],
  ["HTTP 429", response({}, 429), /限流/],
  ["HTTP 503", response({}, 503), /暂不可用/],
  ["redirect", response("", 302, { Location: "https://example.com" }), /HTTP 状态/],
  ["truthy success", response({ success: "true", obj: { loginStatus: 1 } }), /未确认成功/]
]) test("invalid probe response is not accepted: " + label, async () => {
  const r = await execute({ responses: [bad] }); assert.equal(r.calls.length, 1); assert.match(text(r), expected);
});

test("points API token validation error does not falsely expire a valid session", async () => {
  const tokenError = response({ success: false, errorCode: "999999", errorMessage: "权限验证失败,token错误" });
  const r = await execute({ responses: [loggedIn(), tokenError, today(true), ordinary(1), tokenError] });
  assert.match(text(r), /两项签到已确认/); assert.match(text(r), /积分余额未能核验/);
});

test("Set-Cookie updates use CAS and carry renewed session to later requests", async () => {
  const r = await execute({ responses: [response({ success: true, obj: { loginStatus: 1, mobile: PHONE } }, 200, { "Set-Cookie": ["sessionId=fixture-new-session; Path=/; HttpOnly", "mimp_g_env=5.0; Expires=Thu, 05 Nov 2026 01:00:00 GMT; SameSite=Lax"] }), points(), today(true), ordinary(1), points()] });
  assert.match(JSON.parse(r.stored[PROFILE]).cookie, /sessionId=fixture-new-session/);
  assert.ok(!JSON.parse(r.stored[PROFILE]).cookie.includes("Expires"));
  assert.match(r.calls[1].headers.Cookie, /sessionId=fixture-new-session/);
});

test("response cannot change identity via Set-Cookie", async () => {
  const stored = prefs();
  const r = await execute({ stored, responses: [response({ success: true, obj: { loginStatus: 1 } }, 200, { "set-cookie": "_login_user_id_=fixture-other-user; Path=/" })] });
  assert.equal(r.stored[PROFILE], stored[PROFILE]); assert.match(text(r), /不同账号/); assert.equal(r.calls.length, 1);
});

test("explicit session revocation does not fall back to an old JSESSIONID", async () => {
  const r = await execute({ responses: [response({ success: true, obj: { loginStatus: 1 } }, 200, { "set-cookie": "sessionId=; Max-Age=0; Path=/" })] });
  assert.equal(r.calls.length, 1); assert.match(text(r), /撤销登录会话/);
});

test("concurrent capture prevents stale credentials from being saved or used for sign", async () => {
  const fresh = JSON.stringify(profile({ cookie: "sessionId=fixture-other-session" }));
  const r = await execute({ responses: [loggedIn(), points(), (_options, c) => { c.stored[PROFILE] = fresh; return today(false); }] });
  assert.equal(r.calls.length, 3); assert.equal(r.stored[PROFILE], fresh); assert.equal(r.stored[STATUS], undefined);
  assert.match(text(r), /参数已变化/);
});

test("crossing midnight before sign prevents both writes", async () => {
  const r = await execute({ responses: [loggedIn(), points(), (_options, c) => { c.advance(16 * 3600000); return today(false); }] });
  assert.equal(r.calls.length, 3); assert.equal(state(r).ordinary, "skipped"); assert.match(text(r), /北京时间零点/);
});

test("budget is reserved for verification instead of attempting a late sign", async () => {
  const r = await execute({ responses: [loggedIn(), points(), (_options, c) => { c.advance(44000); return today(false); }, points()] });
  assert.equal(r.calls.filter(c => c.url === URLS.sign || c.url === URLS.ordinary).length, 0);
  assert.equal(state(r).calendar, "failed"); assert.equal(state(r).ordinary, "failed");
});
