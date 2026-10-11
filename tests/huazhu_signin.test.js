const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../huazhu_signin.js"), "utf8");
const SINGLE = "huazhu_signin_token";
const MULTI = "huazhu_signin_tokens";
const UA = "huazhu_signin_user_agent";
const TOKEN = "fixture-private-token-abc123";

function response(body, status = 200, headers = {}) {
  return { statusCode: status, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

function status(signed, extra = {}) {
  return response({ code: 200, content: { signToday: signed, memberPoint: 100, yearSignInCount: 8, ...extra } });
}

async function execute({ prefs = {}, request, responses = [], writable = true, clearTimer = true, fetch: customFetch } = {}) {
  const stored = { ...prefs };
  const calls = [];
  const notices = [];
  const logs = [];
  const waits = [];
  const timers = new Set();
  let clock = 1791727200000;
  let doneCount = 0;
  let complete;
  const completion = new Promise(resolve => { complete = resolve; });
  class Clock extends Date {
    static now() { return clock; }
  }
  const controls = { advance(ms) { clock += ms; }, stored };
  const context = {
    Date: Clock,
    console: { log: (...args) => logs.push(args.join(" ")) },
    $prefs: {
      valueForKey: key => stored[key] || "",
      setValueForKey: (value, key) => {
        if (!writable) return false;
        stored[key] = value;
        return true;
      }
    },
    $notify: (...args) => notices.push(args),
    $done: value => { doneCount++; complete(value); },
    $task: {
      fetch: async options => {
        calls.push(options);
        if (customFetch) return customFetch(options, calls.length, controls);
        const next = responses[calls.length - 1];
        if (next instanceof Error) throw next;
        assert.ok(next, "Unexpected HTTP request: " + options.url);
        return next;
      }
    },
    // 虚拟时钟记录等待时间，真实定时器仅等待 2ms，不触碰真实账号。
    setTimeout: (callback, ms) => {
      waits.push(ms);
      const id = setTimeout(() => { timers.delete(id); clock += ms; callback(); }, 2);
      timers.add(id);
      return id;
    },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); }
  };
  if (!clearTimer) delete context.clearTimeout;
  if (request !== undefined) context.$request = request;
  try {
    vm.runInNewContext(source, context, { timeout: 1000 });
    await Promise.race([completion, new Promise((_, reject) => {
      const id = setTimeout(() => { timers.delete(id); reject(new Error("Script did not finish")); }, 1000);
      timers.add(id);
    })]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doneCount, 1, "$done must be called once");
    return { stored, calls, notices, logs, waits, doneCount };
  } finally {
    timers.forEach(clearTimeout);
  }
}

function output(result) {
  return JSON.stringify({ notices: result.notices, logs: result.logs });
}

function capture(headers = {}, extra = {}) {
  return { url: "https://appgw.huazhu.com/game/sign_header", method: "GET", headers, ...extra };
}

test("capture: mixed-case Cookie, only local token/UA, no HTTP request", async () => {
  const result = await execute({ request: capture({ cOoKiE: "other=1; userToken=" + TOKEN, "USER-Agent": "fixture-UA" }) });
  assert.equal(result.stored[SINGLE], TOKEN);
  assert.equal(result.stored[UA], "fixture-UA");
  assert.equal(result.calls.length, 0);
  assert.match(output(result), /Token获取成功/);
  assert.ok(!output(result).includes(TOKEN));
});

test("capture: skip OPTIONS, unrelated endpoints and absent userToken", async () => {
  for (const request of [
    capture({ Cookie: "userToken=" + TOKEN }, { method: "OPTIONS" }),
    capture({ Cookie: "userToken=" + TOKEN }, { url: "https://unrelated.example/game/sign_header" }),
    capture({ Cookie: "userToken=" + TOKEN }, { url: "https://appgw.huazhu.com/other" }),
    capture({ Cookie: "session=1" })
  ]) {
    const result = await execute({ request });
    assert.equal(result.stored[SINGLE], undefined);
    assert.equal(result.calls.length, 0);
    assert.equal(result.notices.length, 0);
  }
});

test("capture: login fallback and manual multi-account list preservation", async () => {
  const result = await execute({ prefs: { [MULTI]: "first&second" }, request: capture({ Cookie: "userToken=" + TOKEN }, {
    method: "POST", url: "https://hweb-personalcenter.huazhu.com/login/autoLogin?source=app"
  }) });
  assert.equal(result.stored[SINGLE], TOKEN);
  assert.equal(result.stored[MULTI], "first&second");
  assert.match(output(result), /手动多账号列表/);
});

test("capture: unchanged token stays quiet and failed storage is reported", async () => {
  const request = capture({ Cookie: "userToken=" + TOKEN });
  const unchanged = await execute({ prefs: { [SINGLE]: TOKEN }, request });
  assert.equal(unchanged.notices.length, 0);
  const failed = await execute({ request, writable: false });
  assert.match(output(failed), /Token保存失败/);
  assert.equal(failed.stored[SINGLE], undefined);
});

test("task: no credentials or malformed credentials do not send requests", async () => {
  const empty = await execute();
  assert.match(output(empty), /尚未获取Token/);
  assert.equal(empty.calls.length, 0);
  const invalid = await execute({ prefs: { [SINGLE]: "bad;Cookie=injection" } });
  assert.match(output(invalid), /Token格式不正确/);
  assert.equal(invalid.calls.length, 0);
  assert.ok(!output(invalid).includes("Cookie=injection"));
});

test("task: preflight prevents duplicate sign-in", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [status(true)] });
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls[0].url.endsWith("/game/sign_header"));
  assert.match(output(result), /今日已签到/);
  assert.match(output(result), /当前积分：100/);
});

test("task: signs with QX fetch, then confirms state and points", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [
    status(false), response({ code: 200, content: { signResult: true, point: 5 } }), status(true, { memberPoint: 105 })
  ] });
  assert.equal(result.calls.length, 3);
  assert.match(result.calls[1].url, /\/game\/sign_in\?date=\d+$/);
  result.calls.forEach(call => {
    assert.equal(call.method, "GET");
    assert.equal(call.headers.Cookie, "userToken=" + TOKEN);
    assert.equal(call.opts.redirection, false);
    assert.equal(call.opts["auto-cookie"], false);
    assert.equal(new URL(call.url).hostname, "appgw.huazhu.com");
  });
  assert.match(output(result), /签到成功/);
  assert.match(output(result), /本次签到积分：5/);
  assert.match(output(result), /当前积分：105/);
  assert.ok(!output(result).includes(TOKEN));
});

test("task: legacy businessCode success and race-to-already-signed", async () => {
  for (const body of [{ code: 5004 }, { businessCode: "5010" }]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [
      response({ businessCode: "1000", content: { signToday: false } }), response(body), status(true)
    ] });
    assert.match(output(result), /今日已签到/);
    assert.ok(!output(result).includes("本次签到积分"));
  }
});

test("task: HTTP and business authentication failures never retry/sign", async () => {
  for (const failed of [response("expired", 401), response("forbidden", 403), response({ businessCode: "1003" })]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [failed] });
    assert.equal(result.calls.length, 1);
    assert.match(output(result), /登录已失效/);
  }
});

test("task: malformed or failed status query cannot trigger sign-in", async () => {
  for (const failed of [response("<html>error</html>"), response({ code: 5001, message: "服务维护" }), response({ code: 200, content: null })]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [failed] });
    assert.equal(result.calls.length, 1);
    assert.ok(!output(result).includes("签到成功"));
    assert.ok(!output(result).includes("今日已签到"));
  }
});

test("task: no false success if post-sign state remains unsigned or fails", async () => {
  for (const after of [status(false), response("error", 503)]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [
      status(false), response({ code: 200, content: { point: 5 } }), after, after
    ] });
    assert.match(output(result), /结果待确认/);
    assert.ok(!output(result).includes("签到成功"));
  }
});

test("task: explicit already-signed survives a later points-query failure", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [status(false), response({ code: 5004 }), response("expired", 401)] });
  assert.match(output(result), /今日已签到/);
  assert.ok(!output(result).includes("签到成功"));
});

test("task: transient 429/5xx/network errors retry once, respecting short Retry-After", async () => {
  for (const transient of [response("busy", 429, { "Retry-After": "2" }), response("error", 500), new Error("network")]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [transient, status(true)] });
    assert.equal(result.calls.length, 2);
    assert.match(output(result), /今日已签到/);
    assert.ok(result.waits.includes(transient instanceof Error || transient.statusCode === 500 ? 1000 : 2000));
  }
  const repeated = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [response("busy", 429), response("busy", 429)] });
  assert.equal(repeated.calls.length, 2);
  assert.match(output(repeated), /限流/);
});

test("task: long Retry-After is deferred rather than shortened or ignored", async () => {
  for (const value of ["60", new Date(1791727200000 + 60000).toUTCString()]) {
    const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [response("busy", 429, { "retry-after": value })] });
    assert.equal(result.calls.length, 1);
    assert.match(output(result), /稍后重试/);
  }
});

test("task: hung fetch is bounded and completes once", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, fetch: () => new Promise(() => {}) });
  assert.equal(result.calls.length, 2);
  assert.match(output(result), /请求超时/);
});

test("task: supports a QX runtime without clearTimeout", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, clearTimer: false, responses: [
    status(false), response({ code: 200, content: { point: 5 } }), status(true)
  ] });
  assert.equal(result.calls.length, 3);
  assert.match(output(result), /签到成功/);
});

test("task: renewal from Set-Cookie is saved and used immediately without leaking", async () => {
  const fresh = "fixture-renewed-token-xyz456";
  const renewed = status(false);
  renewed.headers = { "Set-Cookie": ["other=1; Path=/", "userToken=" + fresh + "; Path=/; HttpOnly"] };
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [
    renewed, response({ code: 200, content: { point: 5 } }), status(true)
  ] });
  assert.equal(result.stored[SINGLE], fresh);
  assert.equal(result.calls[1].headers.Cookie, "userToken=" + fresh);
  assert.ok(!output(result).includes(TOKEN));
  assert.ok(!output(result).includes(fresh));
});

test("task: failure response cannot overwrite credentials with Set-Cookie", async () => {
  const failed = response({ code: 5001, message: "失败" }, 200, { "set-cookie": "userToken=untrusted; Path=/" });
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [failed] });
  assert.equal(result.stored[SINGLE], TOKEN);
});

test("task: sequential multi-account execution, deduplication and per-account renewal", async () => {
  const first = "fixture-account-one";
  const second = "fixture-account-two";
  const fresh = "fixture-account-one-renewed";
  const result = await execute({ prefs: { [SINGLE]: "ignored-captured-token", [MULTI]: first + "\n" + second + "&" + first }, responses: [
    response({ code: 200, content: { signToday: true } }, 200, { "set-cookie": "other=1; Path=/, userToken=" + fresh + "; Path=/" }), status(true)
  ] });
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].headers.Cookie, "userToken=" + first);
  assert.equal(result.calls[1].headers.Cookie, "userToken=" + second);
  assert.equal(result.stored[MULTI], fresh + "&" + second);
  assert.match(output(result), /全部账号已完成/);
  [first, second, fresh].forEach(token => assert.ok(!output(result).includes(token)));
});

test("task: one expired account does not stop later accounts", async () => {
  const result = await execute({ prefs: { [MULTI]: "expired-account&valid-account" }, responses: [response("expired", 401), status(true)] });
  assert.equal(result.calls.length, 2);
  assert.match(output(result), /账号1：登录已失效/);
  assert.match(output(result), /账号2：今日已签到/);
});

test("task: concurrent user edits are not overwritten by renewal", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, fetch: (options, count, controls) => {
    controls.stored[SINGLE] = "user-edited-new-token";
    return response({ code: 200, content: { signToday: true } }, 200, { "set-cookie": "userToken=server-fresh-token; Path=/" });
  } });
  assert.equal(result.stored[SINGLE], "user-edited-new-token");
  assert.match(output(result), /未覆盖/);
});

test("task: task budget reports unexecuted accounts", async () => {
  const result = await execute({ prefs: { [MULTI]: "first-account&second-account" }, fetch: (options, count, controls) => {
    controls.advance(45000);
    return status(true);
  } });
  assert.equal(result.calls.length, 1);
  assert.match(output(result), /剩余 1 个账号未执行/);
});

test("task: server messages redact known tokens and cookies", async () => {
  const result = await execute({ prefs: { [SINGLE]: TOKEN }, responses: [
    status(false), response({ code: 5001, message: "request failed " + TOKEN + " userToken=another-secret" })
  ] });
  assert.ok(!output(result).includes(TOKEN));
  assert.ok(!output(result).includes("another-secret"));
  assert.match(output(result), /REDACTED/);
});
