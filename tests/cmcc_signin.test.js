const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../cmcc_signin.js"), "utf8");
const conf = fs.readFileSync(path.join(__dirname, "../cmcc_signin.conf"), "utf8");
const PROFILE = "cmcc_signin_profile_v1";
const STATUS = "cmcc_signin_status_v1";
const PHONE = "15100000000"; // 合成测试数据，不使用真实账号。
const PHONE2 = "15100000001";
const TOKEN = "JSESSIONID=fixture-app-private; UID=fixture-uid";
const NATIVE = "https://client.app.coc.10086.cn/biz-orange/LN/uamonekeylogin/autoLogin";
const SSO = "https://wx.10086.cn/qwhdsso/appTokenLogin?sid=fixture-sid";
const DEST = "https://wx.10086.cn/qwhdhub/qwhdmark/1021122301?token=fixture-activity-private";
const TIME = Date.parse("2026-11-05T00:23:00Z");
const DAY = "20261105";
const UA = "ChinaMobile/12.5.5 fixture-iOS";
const REQKEY = "tVkdaRWRY0ZkV1Vr";
const RESPKEY = "RYV0hCV1lV25KYVJ";
const IV = "VjFSQ1ZtVkQxRTlQ";

function encrypt(text, key = REQKEY, iv = IV) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}
function decrypt(text, key = REQKEY, iv = IV) {
  const cipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(iv));
  return Buffer.concat([cipher.update(Buffer.from(text, "base64")), cipher.final()]).toString("utf8");
}
function md5(text) { return crypto.createHash("md5").update(text).digest("hex"); }
function template(phone = PHONE) {
  return { tel: phone, prov: "270", city: "027", cv: "12.5.5", xk: "a1".repeat(40), reqBody: { cellNum: "fixture-encrypted-own-phone-" + "b".repeat(128) }, sv: "26.7.1", marker: "中文设备模板" };
}
function sso(phone = PHONE) {
  return { userCheckId: Number(phone).toString(16), token: TOKEN, provinceCode: "270", cityCode: "027", carrierOperator: "002", appVersionCode: "12.5.5", userAgent: UA };
}
function profile({ native = true, cached = false, phone = PHONE } = {}) {
  const p = { version: 1, phone, sso: sso(phone) };
  if (native) p.native = { url: NATIVE, plain: JSON.stringify(template(phone)), userAgent: UA, cookie: TOKEN };
  if (cached) p.session = { cookie: "QWHD_SESSION_TOKEN=fixture-session-private", referer: DEST, createdAt: TIME - 1000 };
  return p;
}
function prefs(options = {}) { return { [PROFILE]: JSON.stringify(profile(options)) }; }
function response(body, statusCode = 200, headers = {}) {
  return { statusCode, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}
function success(data = {}, status) { return response({ code: "SUCCESS", status, data }); }
function state(signed, awards = [], extra = {}) {
  return success({ markstatus: [{ date: DAY, status: signed ? "1" : "0" }], userinfo: { accumulateTimes: signed ? 6 : 5 }, taskAwardChance: awards, ...extra });
}
function loginChain() {
  return [response("var loginPath = '/appTokenLogin?sid=fixture-sid';"), success({ url: DEST }),
    response("<html></html>", 200, { "Set-Cookie": "QWHD_SESSION_TOKEN=fixture-session-private; Path=/qwhdhub; HttpOnly" })];
}

async function execute({ stored: initial = {}, request, responses = [], writable = true, timeoutFast = false } = {}) {
  const stored = { ...initial }, calls = [], notices = [], logs = [], timers = new Set();
  let clock = TIME, doneCount = 0, resolve, reject, unexpected;
  const completed = new Promise((yes, no) => { resolve = yes; reject = no; });
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
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
      timers.add(timer);
      return timer;
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
    for (const secret of [PHONE, TOKEN, "fixture-app-private", "fixture-session-private", "fixture-activity-private", "fixture-uid", template().xk, template().reqBody.cellNum]) {
      assert.ok(!output.includes(secret), "Credentials leaked to output");
    }
    for (const options of calls) {
      assert.match(options.url, /^https:\/\/(?:wx\.10086\.cn|client\.app\.coc\.10086\.cn)\//);
      assert.equal(options.opts.redirection, false);
      assert.equal(options.opts["auto-cookie"], false);
    }
    return { stored, calls, notices, logs, context, controls };
  } finally { clearTimeout(guard); timers.forEach(clearTimeout); }
}
function finalText(result) { return result.notices.map(n => n.slice(1).join(" ")).join("\n"); }

test("AES-CBC and MD5 agree with node:crypto, including UTF-8 and block boundaries", async () => {
  const r = await execute({ request: { method: "OPTIONS" } });
  for (const text of ["", "abc", "中移签到🙂", "a".repeat(16), "xyz".repeat(35), JSON.stringify(template())]) {
    for (const key of [REQKEY, RESPKEY, "bAIgvwAuA4tbDr9d"]) {
      const encrypted = vm.runInContext(`aesEncrypt(${JSON.stringify(text)},${JSON.stringify(key)},${JSON.stringify(IV)})`, r.context);
      assert.equal(encrypted, encrypt(text, key));
      assert.equal(vm.runInContext(`aesDecrypt(${JSON.stringify(encrypted)},${JSON.stringify(key)},${JSON.stringify(IV)})`, r.context), text);
    }
    assert.equal(vm.runInContext(`md5(${JSON.stringify(text)})`, r.context), md5(text));
  }
  assert.throws(() => vm.runInContext(`aesDecrypt("???", ${JSON.stringify(REQKEY)}, ${JSON.stringify(IV)})`, r.context));
  const bad = Buffer.from(encrypt("abc"), "base64"); bad[15] ^= 1;
  assert.throws(() => vm.runInContext(`aesDecrypt(${JSON.stringify(bad.toString("base64"))}, ${JSON.stringify(REQKEY)}, ${JSON.stringify(IV)})`, r.context));
});

test("config uses request bodies and matches both supported autoLogin paths", () => {
  const rules = conf.split("\n").filter(line => line.startsWith("^"));
  assert.equal(rules.length, 2);
  for (const url of [NATIVE, NATIVE + "?source=cold", NATIVE.replace("uamonekeylogin", "uamrandcodelogin"), SSO, SSO + "&source=app", SSO.replace("?sid=", "?from=app&sid=")]) {
    assert.ok(rules.some(line => new RegExp(line.split(" url ")[0]).test(url)));
  }
  const scriptUrl = "https://raw.githubusercontent.com/d539834401/QxSignUp/main/cmcc_signin.js?v=20261106.1";
  assert.ok(rules.every(line => line.endsWith("script-request-body " + scriptUrl)));
  assert.ok(conf.includes("23 8 * * * " + scriptUrl + ", tag=中国移动签到, enabled=true"));
  assert.match(conf, /hostname = %APPEND% client\.app\.coc\.10086\.cn wx\.10086\.cn/);
});

test("capture assembles SSO and native templates without making network requests", async () => {
  const first = await execute({ request: { method: "POST", url: NATIVE, headers: { "User-Agent": UA, Cookie: TOKEN }, body: encrypt(JSON.stringify(template())) } });
  assert.equal(first.calls.length, 0);
  assert.match(finalText(first), /参数获取完整/);
  assert.equal(JSON.parse(first.stored[PROFILE]).sso.source, "native");
  const second = await execute({ stored: first.stored, request: { method: "POST", url: SSO, headers: { "user-agent": UA }, body: JSON.stringify(sso()) } });
  assert.equal(second.calls.length, 0);
  assert.match(finalText(second), /参数获取完整/);
  const saved = JSON.parse(second.stored[PROFILE]);
  assert.equal(saved.phone, PHONE);
  assert.equal(saved.native.plain, JSON.stringify(template()));
});

test("capture supports reverse order and a native request without Cookie", async () => {
  const a = await execute({ request: { method: "POST", url: SSO, headers: { "User-Agent": UA }, body: JSON.stringify(sso()) } });
  const b = await execute({ stored: a.stored, request: { method: "POST", url: NATIVE.replace("uamonekeylogin", "uamrandcodelogin"), headers: { "user-agent": UA }, body: encrypt(JSON.stringify(template())) } });
  assert.match(finalText(b), /参数获取完整/);
  assert.equal(JSON.parse(b.stored[PROFILE]).native.cookie, "");
});

test("switching accounts discards old credentials and cached activity cookies", async () => {
  const r = await execute({ stored: prefs({ cached: true }), request: { method: "POST", url: SSO, headers: { "User-Agent": UA }, body: JSON.stringify(sso(PHONE2)) } });
  const p = JSON.parse(r.stored[PROFILE]);
  assert.equal(p.phone, PHONE2);
  assert.equal(p.native, undefined);
  assert.equal(p.session, undefined);
});

for (const [label, request] of [
  ["OPTIONS", { method: "OPTIONS", url: SSO }],
  ["wrong host", { method: "POST", url: SSO.replace("wx.10086.cn", "example.com"), body: JSON.stringify(sso()) }],
  ["missing body", { method: "POST", url: SSO, headers: { "User-Agent": UA } }],
  ["missing token", { method: "POST", url: SSO, headers: { "User-Agent": UA }, body: JSON.stringify({ ...sso(), token: "" }) }],
  ["bad AES", { method: "POST", url: NATIVE, headers: { "User-Agent": UA }, body: "not-encrypted" }],
  ["incomplete template", { method: "POST", url: NATIVE, headers: { "User-Agent": UA }, body: encrypt(JSON.stringify({ tel: PHONE, xk: "abcdefgh" })) }]
]) test("invalid capture preserves stored credentials: " + label, async () => {
  const stored = prefs({ cached: true });
  const r = await execute({ stored, request });
  assert.equal(r.stored[PROFILE], stored[PROFILE]);
  assert.equal(r.calls.length, 0);
});

test("capture reports storage failure", async () => {
  const r = await execute({ writable: false, request: { method: "POST", url: SSO, headers: { "User-Agent": UA }, body: JSON.stringify(sso()) } });
  assert.match(finalText(r), /保存失败/);
});

test("missing credentials finish without requests", async () => {
  const r = await execute();
  assert.equal(r.calls.length, 0);
  assert.match(finalText(r), /获取登录参数/);
});

test("fresh SSO, query, sign, verify and claim all run in QX without Node dependencies", async () => {
  const r = await execute({ stored: prefs(), responses: [...loginChain(), state(false), success({ markPrize: { prizeCategory: "FLOW", prizeValue: 100 } }), state(true, [{ id: 123 }]), success({ prizeName: "fixture reward", prizeCategory: "FEE", prizeValue: 2 })] });
  assert.equal(r.calls.length, 7);
  assert.equal(JSON.parse(r.calls[1].body).token, TOKEN);
  assert.equal(JSON.parse(r.calls[1].body).jwtToken, null);
  assert.equal(JSON.parse(r.calls[4].body).date, DAY);
  assert.match(r.calls[6].url, /taskAward\/123$/);
  assert.equal(r.calls[3].headers.Cookie, "QWHD_SESSION_TOKEN=fixture-session-private");
  assert.match(finalText(r), /签到已确认/);
  assert.match(finalText(r), /已确认领取 1 项/);
  assert.equal(JSON.parse(r.stored[STATUS]).signed, true);
});

test("already signed uses a recent cached session and does not post domark", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [state(true)] });
  assert.equal(r.calls.length, 1);
  assert.match(finalText(r), /今日已签到/);
});

test("cookie expiry rebuilds SSO once before querying", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [response({ code: "FAILED", msg: "登录状态已过期" }), ...loginChain(), state(true)] });
  assert.equal(r.calls.length, 5);
  assert.match(finalText(r), /今日已签到/);
});

test("expired app ticket restores signed native session and retries SSO once", async () => {
  const chain = loginChain();
  const r = await execute({ stored: prefs(), responses: [chain[0], response({ code: "FAILED", msg: "APP登录状态已过期" }),
    options => {
      assert.equal(options.url, NATIVE);
      const plain = decrypt(options.body);
      assert.equal(plain, JSON.stringify(template()));
      const h = options.headers;
      assert.equal(h.xs, md5(NATIVE + "_" + plain + "_Leadeon/SecurityOrganization"));
      assert.equal(decrypt(h["x-token"], "bAIgvwAuA4tbDr9d", "9791027341711819"), template().xk + "_/biz-orange/LN/uamonekeylogin/autoLogin_" + h["x-time"] + "_" + h["x-nonce"]);
      assert.equal(h["x-sign"], md5(h["x-token"] + "_" + h["x-time"] + "_" + h["x-nonce"] + "_fixture-app-private"));
      return response(encrypt(JSON.stringify({ retCode: "000000" }), RESPKEY), 200, { "set-cookie": ["JSESSIONID=fixture-restored; Path=/; HttpOnly", "UID=fixture-restored-uid; Expires=Wed, 05 Nov 2031 10:00:00 GMT; Secure; SameSite=None"] });
    }, options => {
      const body = JSON.parse(options.body);
      assert.equal(body.token, "JSESSIONID=fixture-restored; UID=fixture-restored-uid");
      assert.equal(body.userCheckId, Number(PHONE).toString(16));
      return chain[1];
    }, chain[2], state(true)] });
  assert.equal(r.calls.length, 6);
  assert.match(finalText(r), /今日已签到/);
  assert.match(JSON.parse(r.stored[PROFILE]).sso.token, /fixture-restored/);
});

for (const [code, expected] of [["233031", /一分钟/], ["420000", /其它设备会话占用/], ["210000", /重新登录/]]) {
  test("native recovery failure does not sign: " + code, async () => {
    const r = await execute({ stored: prefs(), responses: [loginChain()[0], response({ code: "FAILED", msg: "登录状态已过期" }), response(encrypt(JSON.stringify({ retCode: code }), RESPKEY))] });
    assert.equal(r.calls.length, 3);
    assert.match(finalText(r), expected);
    assert.equal(r.calls.filter(c => c.url.endsWith("domark")).length, 0);
  });
}

test("expired ticket without native template gives capture instructions", async () => {
  const r = await execute({ stored: prefs({ native: false }), responses: [loginChain()[0], response({ code: "FAILED", msg: "APP登录状态已过期" })] });
  assert.equal(r.calls.length, 2);
  assert.match(finalText(r), /冷启动抓取规则/);
});

test("native recovery has a persistent one-minute rate guard", async () => {
  const p = profile(); p.nativeAttemptAt = TIME - 30000;
  const r = await execute({ stored: { [PROFILE]: JSON.stringify(p) }, responses: [loginChain()[0], response({ code: "FAILED", msg: "登录状态已过期" })] });
  assert.equal(r.calls.length, 2);
  assert.match(finalText(r), /一分钟内/);
});

test("external or wrong activity redirects are rejected before fetching credentials", async () => {
  for (const url of ["https://example.com/?token=foo", "https://wx.10086.cn.evil.invalid/qwhdhub/", "https://wx.10086.cn/qwhdhub/qwhdmark/123?token=foo"]) {
    const r = await execute({ stored: prefs(), responses: [loginChain()[0], success({ url })] });
    assert.equal(r.calls.length, 2);
    assert.match(finalText(r), /不同的活动地址/);
  }
});

for (const [label, badResponse, expected] of [
  ["array", response([]), /JSON 对象/],
  ["string", response(JSON.stringify("系统繁忙")), /JSON 对象/],
  ["HTML", response("<html>blocked</html>"), /JSON 对象/],
  ["missing calendar", success({ userinfo: {} }), /状态结构已变化/],
  ["unknown today status", success({ markstatus: [{ date: DAY, status: "new" }] }), /无法识别/],
  ["HTTP 403", response({}, 403), /拒绝请求/],
  ["HTTP 429", response({}, 429), /限流/],
  ["HTTP 503", response({}, 503), /暂不可用/],
  ["HTTP redirect", response("", 302, { Location: "https://example.com" }), /HTTP 状态/]
]) test("query failure never submits a sign request: " + label, async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [badResponse] });
  assert.equal(r.calls.length, 1);
  assert.match(finalText(r), expected);
});

test("SUCCESS without a confirmed signed calendar is pending", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [state(false), success(), state(false)] });
  assert.match(finalText(r), /签到结果待确认/);
  assert.equal(JSON.parse(r.stored[STATUS]).signed, false);
  assert.equal(r.calls.filter(c => c.url.endsWith("domark")).length, 1);
});

test("lost submission response is reconciled by status without a second submission", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [state(false), new Error("fixture-app-private network failure"), state(true)] });
  assert.match(finalText(r), /签到已确认/);
  assert.equal(r.calls.filter(c => c.url.endsWith("domark")).length, 1);
});

test("a timed-out submission is not retried", async () => {
  const r = await execute({ stored: prefs({ cached: true }), timeoutFast: true, responses: [state(false), () => new Promise(() => {}), state(true)] });
  assert.match(finalText(r), /签到已确认/);
  assert.equal(r.calls.length, 3);
});

test("failure to verify a sign request stays pending", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [state(false), success(), response({}, 503)] });
  assert.match(finalText(r), /无法重新查询/);
  assert.equal(JSON.parse(r.stored[STATUS]).signed, false);
});

test("changing profile while status is queried prevents signing and profile overwrite", async () => {
  const fresh = JSON.stringify(profile({ phone: PHONE2 }));
  const r = await execute({ stored: prefs({ cached: true }), responses: [(_options, c) => { c.stored[PROFILE] = fresh; return state(false); }] });
  assert.equal(r.calls.length, 1);
  assert.equal(r.stored[PROFILE], fresh);
  assert.match(finalText(r), /参数已变化/);
});

test("crossing Beijing midnight before submitting skips signing", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [(_options, c) => { c.advance(16 * 3600000); return state(false); }] });
  assert.equal(r.calls.length, 1);
  assert.match(finalText(r), /跨北京时间零点/);
});

test("budget guard reserves time for a confirmation query", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [(_options, c) => { c.advance(44000); return state(false); }] });
  assert.equal(r.calls.length, 1);
  assert.match(finalText(r), /剩余时间不足/);
});

test("award failure preserves the confirmed sign result and does not retry", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [state(true, [{ id: 1 }]), response({}, 503)] });
  assert.match(finalText(r), /今日已签到/);
  assert.match(finalText(r), /累计奖励领取未确认/);
  assert.equal(JSON.parse(r.stored[STATUS]).signed, true);
  assert.equal(r.calls.length, 2);
});

test("claim toggle and duplicate/path-injection award IDs are respected", async () => {
  const disabled = await execute({ stored: { ...prefs({ cached: true }), cmcc_signin_claim_awards: "false" }, responses: [state(true, [{ id: 1 }])] });
  assert.equal(disabled.calls.length, 1);
  const guarded = await execute({ stored: prefs({ cached: true }), responses: [state(true, [{ id: "../../other" }, { id: 1 }, { id: 1 }]), success({ prizeName: "fixture" })] });
  assert.equal(guarded.calls.length, 2);
  assert.match(guarded.calls[1].url, /taskAward\/1$/);
});

test("unauthenticated or arbitrary response text never leaks to user output", async () => {
  const r = await execute({ stored: prefs({ cached: true }), responses: [response({ code: "ERROR", msg: "fixture-app-private; phone=" + PHONE })] });
  assert.match(finalText(r), /未确认成功/);
});

function nativeOnly({ cookie = TOKEN, tpl = template(), phone = PHONE, url = NATIVE } = {}) {
  return { [PROFILE]: JSON.stringify({ version: 1, phone, native: { url, plain: JSON.stringify(tpl), userAgent: UA, cookie } }) };
}
function nativeSessionResponse() {
  return response(encrypt(JSON.stringify({ retCode: "000000" }), RESPKEY), 200, { "set-cookie": ["JSESSIONID=fixture-restored; Path=/; HttpOnly", "UID=fixture-restored-uid; Path=/"] });
}

test("old partial profile runs from its existing native template without another SSO capture", async () => {
  const r = await execute({ stored: nativeOnly(), responses: [...loginChain(), state(true)] });
  assert.equal(r.calls.length, 4);
  const body = JSON.parse(r.calls[1].body);
  assert.equal(body.provinceCode, "270"); assert.equal(body.cityCode, "027");
  assert.equal(body.appVersionCode, "12.5.5"); assert.equal(body.carrierOperator, "002");
  assert.equal(body.userCheckId, Number(PHONE).toString(16)); assert.equal(body.token, TOKEN);
  assert.equal(JSON.parse(r.stored[PROFILE]).sso.source, "native");
  assert.match(finalText(r), /今日已签到/);
});

test("native bootstrap uses actual template region/version and never hard-codes the fixture region", async () => {
  const tpl = { ...template(), prov: "731", city: "0731", cv: "12.6.1", carrierOperator: "002" };
  const r = await execute({ stored: nativeOnly({ tpl }), responses: [...loginChain(), state(true)] });
  const body = JSON.parse(r.calls[1].body);
  assert.equal(body.provinceCode, "731"); assert.equal(body.cityCode, "0731"); assert.equal(body.appVersionCode, "12.6.1");
});

test("native-only profile with no Cookie establishes its own session before SSO", async () => {
  const r = await execute({ stored: nativeOnly({ cookie: "" }), responses: [options => {
    assert.equal(options.url, NATIVE);
    assert.match(options.headers.Cookie, /^JSESSIONID=[a-f0-9-]+; UID=placeholder$/);
    const jsid = options.headers.Cookie.match(/JSESSIONID=([^;]+)/)[1];
    const h = options.headers;
    assert.equal(h["x-sign"], md5(h["x-token"] + "_" + h["x-time"] + "_" + h["x-nonce"] + "_" + jsid));
    assert.equal(decrypt(options.body), JSON.stringify(template()));
    return nativeSessionResponse();
  }, ...loginChain(), state(true)] });
  assert.equal(r.calls.length, 5);
  assert.equal(JSON.parse(r.calls[2].body).token, "JSESSIONID=fixture-restored; UID=fixture-restored-uid");
  assert.match(finalText(r), /今日已签到/);
});

test("SSO expiry from a migrated native profile refreshes once and proceeds", async () => {
  const chain = loginChain();
  const r = await execute({ stored: nativeOnly(), responses: [chain[0], response({ code: "FAILED", msg: "APP登录状态已过期" }), nativeSessionResponse(), chain[1], chain[2], state(true)] });
  assert.equal(r.calls.filter(c => c.url === NATIVE).length, 1);
  assert.match(finalText(r), /今日已签到/);
});

for (const [field, expected] of [["prov", /省份码/], ["city", /城市码/], ["cv", /App版本/]]) {
  test("incomplete native metadata names the missing field and does not invent a default: " + field, async () => {
    const tpl = template(); delete tpl[field];
    const stored = nativeOnly({ tpl }); const r = await execute({ stored });
    assert.equal(r.calls.length, 0); assert.match(finalText(r), expected);
    assert.equal(r.stored[PROFILE], stored[PROFILE]);
  });
}

test("a template for another phone cannot bootstrap the stored account", async () => {
  const stored = nativeOnly({ tpl: template(PHONE2) });
  const r = await execute({ stored });
  assert.equal(r.calls.length, 0); assert.equal(r.stored[PROFILE], stored[PROFILE]);
});

test("explicit SSO parameters take precedence over template-derived metadata", async () => {
  const p = profile(); p.sso.provinceCode = "731"; p.sso.cityCode = "0731";
  const r = await execute({ stored: { [PROFILE]: JSON.stringify(p) }, responses: [...loginChain(), state(true)] });
  assert.equal(JSON.parse(r.calls[1].body).provinceCode, "731");
  assert.equal(JSON.parse(r.calls[1].body).cityCode, "0731");
});

test("re-capturing an identical old partial template emits the new ready notification", async () => {
  const r = await execute({ stored: nativeOnly(), request: { method: "POST", url: NATIVE, headers: { "User-Agent": UA, Cookie: TOKEN }, body: encrypt(JSON.stringify(template())) } });
  assert.equal(r.calls.length, 0); assert.match(finalText(r), /参数获取完整/);
  assert.match(finalText(r), /无需等待签到页/);
});

test("native profile migration storage failure is reported before any network request", async () => {
  const stored = nativeOnly(); const r = await execute({ stored, writable: false });
  assert.equal(r.calls.length, 0); assert.equal(r.stored[PROFILE], stored[PROFILE]); assert.match(finalText(r), /保存失败/);
});

test("native URLs with query parameters preserve the path in the signed token", async () => {
  const url = NATIVE + "?source=cold";
  const r = await execute({ stored: nativeOnly({ cookie: "", url }), responses: [options => {
    assert.equal(options.url, url);
    const h = options.headers;
    assert.equal(h.xs, md5(url + "_" + JSON.stringify(template()) + "_Leadeon/SecurityOrganization"));
    assert.ok(decrypt(h["x-token"], "bAIgvwAuA4tbDr9d", "9791027341711819").includes("/autoLogin?source=cold_"));
    return nativeSessionResponse();
  }, ...loginChain(), state(true)] });
  assert.match(finalText(r), /今日已签到/);
});

test("SSO capture accepts sid after other query parameters without making requests", async () => {
  const r = await execute({ request: { method: "POST", url: "https://wx.10086.cn/qwhdsso/appTokenLogin?from=app&sid=fixture-sid&extra=1", headers: { "User-Agent": UA }, body: JSON.stringify(sso()) } });
  assert.equal(r.calls.length, 0); assert.match(finalText(r), /登录参数可用/);
  assert.equal(JSON.parse(r.stored[PROFILE]).sso.token, TOKEN);
});
