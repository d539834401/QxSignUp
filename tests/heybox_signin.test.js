const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../heybox_signin.js"), "utf8");
const PROFILE = "heybox_signin_profile_v1";
const STATUS = "heybox_signin_status_v1";
const NOW = Date.parse("2026-11-05T01:00:00Z");
const DAY = Math.floor((NOW / 1000 + 8 * 3600) / 86400);
const PKEY = "fixture-private-pkey-never-log";
const TOKEN = "fixture-private-token-never-log";
const profile = {
  params: { dw: "390", lang: "zh-CN", version: "1.3.397", device_info: "iPhone", os_type: "iOS", os_version: "26.1",
    x_os_type: "iOS", x_client_type: "mobile", heybox_id: "12345678", time_zone: "Asia/Shanghai", x_app: "heybox", device_id: "0123456789abcdef0123456789abcdef" },
  pkey: PKEY, tokenid: TOKEN, userAgent: "xiaoheihe/1.3.397 fixture-iOS-UA", statePath: "/task/sign_v3/get_sign_state"
};
const unsigned = { state: "ignore", signed_date: DAY - 1 };
const signed = { state: "ok", signed_date: DAY, sign_in_coin: 20 };
const ledgerRow = { event_desc: "完成签到任务", type: "inc", timestamp: "2026-11-05 08:20:00", value: 20 };

function response(result, { statusCode = 200, base64 = false, bodyStatus = "ok", msg = "" } = {}) {
  const body = JSON.stringify({ status: bodyStatus, msg, result });
  return { statusCode, body: base64 ? Buffer.from(body).toString("base64") : body };
}
function history(rows = []) { return response({ history: rows }); }
function noticeText(result) { return JSON.stringify({ notices: result.notices, logs: result.logs }); }
function resultState(result) { return JSON.parse(result.stored[STATUS]); }
function signCalls(result) { return result.calls.filter(call => new URL(call.url).pathname === "/task/sign_v3/sign"); }

async function execute({ prefs, request, responses = [], fetch: customFetch, writable = true, now = NOW, clearTimer = true } = {}) {
  const stored = { ...(request === undefined ? { [PROFILE]: JSON.stringify(profile) } : {}), ...prefs };
  const calls = [], notices = [], logs = [], waits = [];
  const timers = new Set();
  let clock = now, doneCount = 0, complete;
  const completed = new Promise(resolve => { complete = resolve; });
  class Clock extends Date { static now() { return clock; } }
  const controls = { stored, advance(ms) { clock += ms; } };
  const context = {
    Date: Clock,
    console: { log: (...args) => logs.push(args.join(" ")) },
    $prefs: {
      valueForKey: key => stored[key] || "",
      setValueForKey: (value, key) => { if (!writable) return false; stored[key] = value; return true; }
    },
    $notify: (...args) => notices.push(args),
    $done: () => { doneCount++; complete(); },
    $task: { fetch: async options => {
      calls.push(options);
      if (customFetch) return customFetch(options, calls.length, controls);
      const next = responses[calls.length - 1];
      assert.ok(next, "Unexpected request: " + options.url);
      if (next instanceof Error) throw next;
      return next;
    } },
    setTimeout: (callback, ms) => {
      waits.push(ms);
      const id = setTimeout(() => { timers.delete(id); clock += ms; callback(); }, ms > 3000 ? 40 : 1);
      timers.add(id);
      return id;
    },
    clearTimeout: id => { timers.delete(id); clearTimeout(id); }
  };
  if (!clearTimer) delete context.clearTimeout;
  if (request !== undefined) context.$request = request;
  try {
    vm.runInNewContext(source, context, { timeout: 1000 });
    await Promise.race([completed, new Promise((_, reject) => {
      const id = setTimeout(() => reject(new Error("Script did not finish")), 1500);
      timers.add(id);
    })]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(doneCount, 1, "$done must run exactly once");
    const result = { stored, calls, notices, logs, waits, doneCount };
    assert.ok(!noticeText(result).includes(PKEY));
    assert.ok(!noticeText(result).includes(TOKEN));
    return result;
  } finally { timers.forEach(clearTimeout); }
}

function capture(extra = {}) {
  return { url: "https://api.xiaoheihe.cn/task/sign_list?" + new URLSearchParams(profile.params), method: "GET",
    headers: { cOoKiE: "extra=discard; pkey=" + PKEY + "; x_xhh_tokenid=" + TOKEN, "USER-Agent": profile.userAgent }, ...extra };
}

test("capture: stores whitelisted iOS fields and cookies locally without HTTP", async () => {
  const result = await execute({ request: capture({ url: capture().url + "&nonce=discard&_time=discard&hkey=discard&tracking=discard" }) });
  const captured = JSON.parse(result.stored[PROFILE]);
  assert.deepEqual(captured, profile);
  assert.equal(result.calls.length, 0);
  assert.match(noticeText(result), /参数获取成功/);
});

test("capture: ignores OPTIONS, other hosts, unrelated paths and sign mutations", async () => {
  for (const request of [capture({ method: "OPTIONS" }), capture({ method: "POST" }),
    capture({ url: capture().url.replace("api.xiaoheihe.cn", "api.xiaoheihe.cn.evil.example") }),
    capture({ url: capture().url.replace("/task/sign_list", "/account/login") }),
    capture({ url: capture().url.replace("/task/sign_list", "/task/sign_v3/sign") })]) {
    const result = await execute({ request });
    assert.equal(result.stored[PROFILE], undefined);
    assert.equal(result.calls.length, 0);
    assert.equal(result.notices.length, 0);
  }
});

test("capture: does not fabricate missing device parameters or merge another account", async () => {
  for (const key of ["device_id", "heybox_id", "os_version", "version"]) {
    const url = new URL(capture().url); url.searchParams.delete(key);
    const result = await execute({ request: capture({ url: url.href }), prefs: { [PROFILE]: JSON.stringify(profile) } });
    assert.equal(result.stored[PROFILE], JSON.stringify(profile));
    assert.doesNotMatch(noticeText(result), /获取成功/);
  }
  const noCookie = await execute({ request: capture({ headers: { Cookie: "other=missing" } }) });
  assert.equal(noCookie.stored[PROFILE], undefined);
  const android = await execute({ request: capture({ url: capture().url.replaceAll("iOS", "Android") }) });
  assert.equal(android.stored[PROFILE], undefined);
});

test("capture: unchanged profile is quiet; storage failure never reports success", async () => {
  const unchanged = await execute({ request: capture(), prefs: { [PROFILE]: JSON.stringify(profile), [STATUS]: "existing" } });
  assert.equal(unchanged.notices.length, 0);
  assert.equal(unchanged.stored[STATUS], "existing");
  const failed = await execute({ request: capture(), writable: false });
  assert.match(noticeText(failed), /参数获取失败/);
  assert.doesNotMatch(noticeText(failed), /获取成功/);
});

test("capture: learns v4 status endpoint and resets results on account switch", async () => {
  const request = capture({ url: capture().url.replace("sign_list", "sign_v4/get_sign_state") });
  const v4 = await execute({ request });
  assert.equal(JSON.parse(v4.stored[PROFILE]).statePath, "/task/sign_v4/get_sign_state");
  const keep = await execute({ request: capture(), prefs: { [PROFILE]: v4.stored[PROFILE] } });
  assert.equal(JSON.parse(keep.stored[PROFILE]).statePath, "/task/sign_v4/get_sign_state");
  const other = await execute({ request: capture({ url: capture().url.replace("12345678", "87654321") }), prefs: { [PROFILE]: JSON.stringify(profile), [STATUS]: "old-result" } });
  assert.equal(other.stored[STATUS], "");
});

test("capture: rejects duplicate query values and malformed encoding", async () => {
  for (const suffix of ["&device_id=different", "&device_id=%ZZ"]) {
    const result = await execute({ request: capture({ url: capture().url + suffix }) });
    assert.equal(result.stored[PROFILE], undefined);
    assert.match(noticeText(result), /参数获取失败/);
  }
});

test("task: absent, corrupt and unsafe stored credentials never make requests", async () => {
  for (const value of ["", "{broken", JSON.stringify({ ...profile, pkey: "injection;other=1" }),
    JSON.stringify({ ...profile, statePath: "https://evil.example/steal" }),
    JSON.stringify({ ...profile, params: { ...profile.params, device_id: "" } })]) {
    const result = await execute({ prefs: { [PROFILE]: value } });
    assert.equal(result.calls.length, 0);
    assert.doesNotMatch(noticeText(result), /签到成功/);
  }
});

test("task: confirmed today skips sign and separately confirms reward history", async () => {
  const result = await execute({ responses: [response(signed, { base64: true }), history([ledgerRow])] });
  assert.equal(signCalls(result).length, 0);
  assert.match(noticeText(result), /今日已签到/);
  assert.equal(resultState(result).signed, true);
  assert.equal(resultState(result).rewardConfirmed, true);
  assert.equal(resultState(result).coin, 20);
});

test("task: ignore with current signed_date is already signed", async () => {
  const result = await execute({ responses: [response({ state: "ignore", signed_date: String(DAY) }), history([])] });
  assert.equal(signCalls(result).length, 0);
  assert.equal(resultState(result).signed, true);
  assert.equal(resultState(result).rewardConfirmed, false);
  assert.match(noticeText(result), /奖励流水尚未确认/);
});

test("task: today's real reward can confirm sign even when state omits a date", async () => {
  const result = await execute({ responses: [response({ state: "ok" }), history([ledgerRow])] });
  assert.equal(signCalls(result).length, 0);
  assert.equal(resultState(result).rewardConfirmed, true);
});

test("task: missing signed_date and unknown states are not assumed successful", async () => {
  for (const state of [{ state: "ok" }, { state: "ignore", signed_date: null }, { state: "new-enum", signed_date: DAY }]) {
    const result = await execute({ responses: [response(state), history([])] });
    assert.equal(signCalls(result).length, 0);
    assert.equal(resultState(result).status, "pending");
    assert.doesNotMatch(noticeText(result), /签到成功/);
  }
});

test("task: signs once, polls waiting, then verifies today's reward", async () => {
  const result = await execute({ responses: [response(unsigned), history([]), response({ state: "" }),
    response({ state: "waiting" }), response(signed, { base64: true }), history([ledgerRow])] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "confirmed");
  assert.equal(resultState(result).coin, 20);
  assert.match(noticeText(result), /签到成功/);
  assert.ok(result.calls.every(call => new URL(call.url).hostname === "api.xiaoheihe.cn" && call.method === "GET"));
  result.calls.forEach(call => {
    assert.equal(call.opts.redirection, false);
    assert.equal(call.opts["auto-cookie"], false);
    assert.ok(call.headers.cookie.includes(PKEY));
    assert.equal(call.headers["user-agent"], profile.userAgent);
  });
  const call = signCalls(result)[0], url = new URL(call.url);
  assert.match(url.searchParams.get("_rnd"), /^14:[A-F0-9]{1,8}$/);
  assert.equal(url.searchParams.get("device_id"), profile.params.device_id);
  assert.equal(url.searchParams.get("version"), profile.params.version);
  assert.equal(url.searchParams.get("os_version"), profile.params.os_version);
  const inner = crypto.createHash("md5").update(call.url).digest("hex").replaceAll("a", "a1");
  const expected = crypto.createHash("md5").update(inner).digest("hex");
  assert.ok(call.headers.cookie.includes("hkey=" + expected));
});

test("task: signed status without actual reward remains pending", async () => {
  const result = await execute({ responses: [response(unsigned), history([]), response({ state: "" }), response(signed), history([])] });
  assert.equal(resultState(result).status, "pending");
  assert.equal(resultState(result).signed, true);
  assert.equal(resultState(result).rewardConfirmed, false);
  assert.match(noticeText(result), /奖励待确认/);
  assert.doesNotMatch(noticeText(result), /签到成功/);
});

test("task: waiting never becomes successful after polling ends", async () => {
  const result = await execute({ responses: [response(unsigned), history([]), response({ state: "" }),
    response({ state: "waiting" }), response({ state: "waiting" }), response({ state: "waiting" }), history([])] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "pending");
  assert.equal(resultState(result).signed, false);
  assert.doesNotMatch(noticeText(result), /签到成功/);
});

test("task: yesterday's state does not suppress a new sign-in", async () => {
  const result = await execute({ responses: [response({ ...signed, signed_date: DAY - 1 }), history([{ ...ledgerRow, timestamp: "2026-11-04 08:00:00" }]),
    response({ state: "" }), response(signed), history([ledgerRow])] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).date, "2026-11-05");
});

test("task: other rewards, wrong dates, zero and negative entries do not confirm sign reward", async () => {
  const rows = [{ ...ledgerRow, event_desc: "完成分享任务" }, { ...ledgerRow, timestamp: "2026-11-04 08:00:00" },
    { ...ledgerRow, value: 0 }, { ...ledgerRow, value: -20 }, { ...ledgerRow, type: "dec" }, { ...ledgerRow, value: null }];
  const result = await execute({ responses: [response(signed), history(rows)] });
  assert.equal(resultState(result).rewardConfirmed, false);
  assert.equal(resultState(result).coin, null);
});

test("task: optional wallet failure does not cause duplicate sign-in or claim nonpayment", async () => {
  const result = await execute({ responses: [response(signed), new Error("network " + PKEY + " " + TOKEN)] });
  assert.equal(signCalls(result).length, 0);
  assert.equal(resultState(result).signed, true);
  assert.match(noticeText(result), /奖励流水尚未确认/);
});

test("task: HTTP 401/403 and business auth errors stop before mutation", async () => {
  for (const reply of [response({}, { statusCode: 401 }), response({}, { statusCode: 403 }),
    response({}, { bodyStatus: "relogin", msg: PKEY }), response({}, { bodyStatus: "failed", msg: "登录已过期 " + TOKEN })]) {
    const result = await execute({ responses: [reply] });
    assert.equal(resultState(result).status, "auth");
    assert.equal(signCalls(result).length, 0);
    assert.equal(result.calls.length, 1);
  }
});

test("task: malformed and redirected preflight responses stop without sign-in", async () => {
  for (const reply of [{ statusCode: 200, body: "<html>" + PKEY + "</html>" }, { statusCode: 200, body: "not-json" },
    response({}, { statusCode: 302 }), response({}, { statusCode: 429 }), response({}, { bodyStatus: "failed", msg: TOKEN })]) {
    const result = await execute({ responses: [reply] });
    assert.equal(signCalls(result).length, 0);
    assert.doesNotMatch(noticeText(result), /签到成功/);
  }
});

test("task: uncertain submission from network or 5xx is never resubmitted", async () => {
  for (const submit of [new Error("network " + PKEY), response({}, { statusCode: 503 })]) {
    const result = await execute({ responses: [response(unsigned), history([]), submit, response(signed), history([ledgerRow])] });
    assert.equal(signCalls(result).length, 1);
    assert.equal(resultState(result).status, "confirmed");
  }
});

test("task: uncertain submission followed by failing polls stays pending", async () => {
  const result = await execute({ responses: [response(unsigned), history([]), new Error("network"),
    new Error("network"), response({}, { statusCode: 503 }), { statusCode: 200, body: "not-json" }, history([])] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "pending");
});

test("task: actual fetch timeout completes once and still checks result", async () => {
  const replies = [response(unsigned), history([]), null, response(signed), history([ledgerRow])];
  const result = await execute({ fetch: (options, index) => index === 3 ? new Promise(() => {}) : replies[index - 1] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "confirmed");
  assert.equal(result.doneCount, 1);
});

test("task: total execution budget bounds slow requests and never repeats mutation", async () => {
  const result = await execute({ fetch: (options, index, controls) => {
    if (index <= 3) {
      controls.advance(5000);
      return index === 1 ? response(unsigned) : index === 2 ? history([]) : response({ state: "" });
    }
    return new Promise(() => {});
  } });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "pending");
  assert.doesNotMatch(noticeText(result), /签到成功/);
  assert.ok(result.calls.length <= 7);
});

test("task: captured v4 status query retains iOS signing and v3 sign endpoint", async () => {
  const v4 = { ...profile, statePath: "/task/sign_v4/get_sign_state" };
  const result = await execute({ prefs: { [PROFILE]: JSON.stringify(v4) }, responses: [
    response(unsigned), history([]), response({ state: "" }), response(signed), history([ledgerRow])
  ] });
  assert.equal(new URL(result.calls[0].url).pathname, v4.statePath);
  assert.equal(new URL(result.calls[3].url).pathname, v4.statePath);
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "confirmed");
});

test("task: business rejection of mutation stops without retry or success", async () => {
  const result = await execute({ responses: [response(unsigned), history([]), response({}, { bodyStatus: "failed", msg: "拒绝请求 " + PKEY })] });
  assert.equal(signCalls(result).length, 1);
  assert.equal(result.calls.length, 3);
  assert.equal(resultState(result).status, "fail");
  assert.doesNotMatch(noticeText(result), /签到成功/);
});

test("task: crossing Beijing midnight cannot report the previous day's result as today's", async () => {
  const start = Date.parse("2026-11-05T15:59:58Z");
  const replies = [response(unsigned), history([]), response({ state: "" }), history([ledgerRow])];
  const result = await execute({ now: start, fetch: (options, index, controls) => {
    if (index === 3) controls.advance(3000);
    return replies[index - 1];
  } });
  assert.equal(signCalls(result).length, 1);
  assert.equal(resultState(result).status, "pending");
  assert.match(noticeText(result), /北京时间零点/);
});

test("task: newer account's local status is not overwritten by an in-flight task", async () => {
  const replacement = { ...profile, params: { ...profile.params, heybox_id: "87654321" } };
  const result = await execute({ prefs: { [STATUS]: "new-account-state" }, fetch: (options, index, controls) => {
    if (index === 2) { controls.stored[PROFILE] = JSON.stringify(replacement); return history([ledgerRow]); }
    return response(signed);
  } });
  assert.equal(result.stored[STATUS], "new-account-state");
  assert.equal(signCalls(result).length, 0);
});

test("task: result storage failure still finishes and reports the actual outcome", async () => {
  const result = await execute({ writable: false, responses: [response(signed), history([ledgerRow])] });
  assert.equal(result.stored[STATUS], undefined);
  assert.match(noticeText(result), /本次结果未写入/);
  assert.match(noticeText(result), /今日已签到/);
});

const cryptoContext = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("// 入口放在")), cryptoContext);
const primitives = vm.runInContext("({utf8Bytes,base64,b64decode,md5hex,sha3_512,hmacSha3_512,queryHkey,cookieHkey,genRnd,webSignature,genNonce})", cryptoContext);

for (const value of ["", "abc", "小黑盒签到 😀", "a".repeat(55), "b".repeat(56), "c".repeat(64), "d".repeat(71), "e".repeat(72), "f".repeat(145)]) {
  test("crypto: MD5/SHA3/Base64 agree with Node for " + Buffer.byteLength(value) + " bytes", () => {
    const bytes = primitives.utf8Bytes(value);
    assert.equal(Buffer.from(bytes).toString("hex"), Buffer.from(value).toString("hex"));
    assert.equal(primitives.md5hex(bytes), crypto.createHash("md5").update(value).digest("hex"));
    assert.equal(Buffer.from(primitives.sha3_512(bytes)).toString("hex"), crypto.createHash("sha3-512").update(value).digest("hex"));
    assert.equal(primitives.base64(bytes), Buffer.from(value).toString("base64"));
    assert.equal(primitives.b64decode(primitives.base64(bytes)), value);
  });
}

test("crypto: SHA3 HMAC matches Node including long keys", () => {
  for (const key of ["", "key", "k".repeat(72), "k".repeat(100)]) {
    const actual = Buffer.from(primitives.hmacSha3_512(primitives.utf8Bytes(key), primitives.utf8Bytes("小黑盒 payload"))).toString("hex");
    assert.equal(actual, crypto.createHmac("sha3-512", key).update("小黑盒 payload").digest("hex"));
  }
});

test("crypto: iOS query signature matches independent Node HMAC calculation", () => {
  const time = "1793840400", device = profile.params.device_id, version = profile.params.version;
  const nonce = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", endpoint = "/task/sign_v3/sign";
  const a = crypto.createHmac("sha3-512", device).update(version + "/" + time).digest("base64");
  const b = crypto.createHmac("sha3-512", a).update(endpoint + "/+" + time + "+" + device + "+" + nonce).digest("base64");
  let crc = 0xffffffff;
  for (const byte of Buffer.from(a + b)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xe5a623e0 : 0);
  }
  const expected = ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
  assert.equal(primitives.queryHkey(endpoint, time, device, version, nonce), expected);
});

test("crypto: shared RND v14 matches published native golden vectors", () => {
  // Cansiny0320/heybox-daily test/fixtures/native-v14.json, first two distinct inputs.
  // Only RND is shared; Android hkey and Android nonce are intentionally not transplanted.
  assert.equal(primitives.genRnd("/account/login_code/", "1793040000", "offline-recovery-probe-1", "", "17", "1.3.398"), "14:8226521A");
  assert.equal(primitives.genRnd("/account/get_login_code/", "1793052345", "0123456789abcdef0123456789abcdef", "", "17", "1.3.398"), "14:DBE8F71C");
});

test("crypto: nonce uses the iOS daily alphabet and changes with time", () => {
  const first = primitives.genNonce("1793840400"), second = primitives.genNonce("1793840400");
  assert.match(first, /^[A-Za-z0-9]{32}$/);
  assert.notEqual(first, second);
  assert.notEqual(first, primitives.genNonce("1793926800"));
});

test("config: capture pattern agrees with runtime and preserves existing hostnames", () => {
  const config = fs.readFileSync(path.join(__dirname, "../heybox_signin.conf"), "utf8");
  const rule = config.split("\n").find(line => line.startsWith("^https:"));
  const regex = new RegExp(rule.split(" url ")[0]);
  assert.ok(regex.test(capture().url));
  assert.ok(regex.test(capture().url.replace("sign_list", "sign_v4/get_sign_state")));
  assert.ok(!regex.test(capture().url.replace("sign_list", "sign_v3/sign")));
  assert.match(config, /hostname = %APPEND% api\.xiaoheihe\.cn/);
  assert.match(config, /QxSignUp\/master\/heybox_signin\.js/);
  assert.ok(!config.includes("codex/heybox-quanx-signin"));
  assert.match(config, /20 8 \* \* \*/);
});
