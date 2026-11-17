const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../taptap_wuwa_signin.js"), "utf8");
const KEY = "codex_taptap_mingchao_request_v1";
const PROFILE = {
  activityCode: "fixture",
  dynamicUrl: "https://www.taptap.cn/webapiv2/event/game-sign/dynamic_data/fixture?source=fixture",
  headers: { Cookie: "session=fixture-private; XSRF-TOKEN=fixture%2Fxsrf", "X-Smfp": "fixture-smfp" },
};
const response = (data) => ({ statusCode: 200, body: JSON.stringify({ success: true, data }) });
const status = (awards = []) => response({ daily_check_in: {
  check_in_log: { total_check_in_days: 3 }, award_list: awards,
} });
const reject = (reason) => () => Promise.reject(reason);

async function execute({ prefs = { [KEY]: JSON.stringify(PROFILE) }, request, responses = [] } = {}) {
  const calls = [], notices = [], logs = [], waits = [];
  const stored = { ...prefs };
  let doneCount = 0, finish;
  const complete = new Promise((resolve) => { finish = resolve; });
  const context = {
    console: { log: (value) => logs.push(value) },
    $prefs: {
      valueForKey: (key) => stored[key],
      setValueForKey: (value, key) => { stored[key] = value; return true; },
    },
    $notify: (...args) => notices.push(args),
    $done: () => { doneCount++; finish(); },
    $task: { fetch: async (options) => {
      calls.push(options);
      assert.ok(calls.length <= responses.length, "Unexpected HTTP request");
      const next = responses[calls.length - 1];
      return typeof next === "function" ? next(options) : next;
    } },
    setTimeout: (callback, ms) => { waits.push(ms); return setTimeout(callback, 0); },
  };
  if (request !== undefined) context.$request = request;
  vm.runInNewContext(source, context, { timeout: 1000 });
  let timer;
  try {
    await Promise.race([complete, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Script did not finish")), 1000);
    })]);
    await new Promise((resolve) => setImmediate(resolve));
  } finally { clearTimeout(timer); }
  assert.equal(doneCount, 1);
  return { calls, notices, logs, waits, stored };
}

function output(result) { return JSON.stringify({ notices: result.notices, logs: result.logs }); }

test("missing credentials and capture keep the existing local storage contract", async () => {
  const empty = await execute({ prefs: {} });
  assert.equal(empty.calls.length, 0);
  assert.match(output(empty), /尚未获取凭据/);
  const captured = await execute({ prefs: {}, request: {
    url: PROFILE.dynamicUrl, headers: { ...PROFILE.headers, Host: "www.taptap.cn" },
  } });
  assert.equal(captured.calls.length, 0);
  const saved = JSON.parse(captured.stored[KEY]);
  assert.equal(saved.activityCode, PROFILE.activityCode);
  assert.equal(saved.headers.Cookie, PROFILE.headers.Cookie);
  assert.equal(saved.headers.Host, undefined);
  assert.ok(!output(captured).includes("fixture-private"));
});

test("successful run still signs, reads status and claims the unlocked award", async () => {
  const result = await execute({ responses: [response({}), status([
    { award_id: 42, status: 1, content: "fixture prize" },
    { award_id: 43, status: 2, content: "already claimed" },
  ]), response({ prize: { title: "fixture prize" }, code: "fixture-code" })] });
  assert.deepEqual(result.calls.map((call) => call.method), ["POST", "GET", "POST"]);
  assert.equal(result.calls[0].body, "activity_code=fixture&smfp=fixture-smfp");
  assert.equal(result.calls[0].headers["X-XSRF-TOKEN"], "fixture/xsrf");
  assert.equal(result.calls[2].body, "award_id=42&smfp=fixture-smfp");
  assert.match(output(result), /执行完成/);
  assert.match(output(result), /fixture-code/);
  assert.match(output(result), /20261117\.1/);
  assert.ok(!output(result).includes("fixture-private"));
});

test("a transient QX status failure retries only GET and then completes", async () => {
  const result = await execute({ responses: [response({}),
    reject({ error: "The request timed out.", errorCode: -1001 }), status()] });
  assert.deepEqual(result.calls.map((call) => call.method), ["POST", "GET", "GET"]);
  assert.deepEqual(result.waits, [1000]);
  assert.match(output(result), /执行完成/);
  assert.match(output(result), /读取签到状态请求失败：The request timed out/);
  assert.ok(!output(result).includes("[object Object]"));
});

test("the screenshot failure preserves sign response and reports the real QX reason", async () => {
  const error = { error: "The request timed out.", errorCode: -1001,
    url: PROFILE.dynamicUrl, headers: PROFILE.headers };
  const result = await execute({ responses: [response({}), reject(error), reject(error)] });
  assert.equal(result.calls.length, 3);
  assert.equal(result.notices[0][1], "签到已提交，状态待确认");
  assert.match(result.notices[0][2], /签到成功/);
  assert.match(result.notices[0][2], /读取签到状态请求失败：The request timed out/);
  assert.match(result.notices[0][2], /错误码 -1001/);
  assert.ok(!output(result).includes("[object Object]"));
  assert.ok(!output(result).includes("fixture-private"));
  assert.ok(!output(result).includes(PROFILE.dynamicUrl));
});

test("sign-in transport failures are readable and never repeat the POST", async () => {
  const result = await execute({ responses: [reject({ error: "Network connection was lost." }), status()] });
  assert.deepEqual(result.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(result.waits.length, 0);
  assert.match(output(result), /签到请求失败：Network connection was lost/);
  assert.ok(!output(result).includes("[object Object]"));
});

test("award transport failures do not repeat a claim or hide other awards", async () => {
  const result = await execute({ responses: [response({}), status([
    { award_id: 1, status: 1 }, { award_id: 2, status: 1 },
  ]), reject({ error: "TLS handshake failed." }), response({ prize: { title: "second prize" } })] });
  assert.deepEqual(result.calls.map((call) => call.method), ["POST", "GET", "POST", "POST"]);
  assert.match(output(result), /领取礼包请求失败：TLS handshake failed/);
  assert.match(output(result), /second prize/);
  assert.equal(result.waits.length, 0);
});

test("login rejection is reported without network retry", async () => {
  const result = await execute({ responses: [response({}), {
    statusCode: 401, body: JSON.stringify({ success: false, message: "登录已失效" }),
  }] });
  assert.equal(result.calls.length, 2);
  assert.equal(result.waits.length, 0);
  assert.match(result.notices[0][2], /读取签到状态失败：登录已失效/);
});

test("error variants are readable and attached secrets are redacted", async () => {
  for (const error of [new Error("fixture native error"), "fixture string error", null, { code: -1009 },
    { message: {}, error: "fixture QX error" },
    { error: "failed https://example.invalid/?token=fixture-private Cookie: session=fixture-private" },
  ]) {
    const result = await execute({ responses: [reject(error), status()] });
    assert.ok(!output(result).includes("[object Object]"));
    assert.ok(!output(result).includes("fixture-private"));
    assert.ok(!output(result).includes("example.invalid"));
  }
});
