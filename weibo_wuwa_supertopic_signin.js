/*
 * 微博「鸣潮超话」签到（Quantumult X）
 *
 * 重写模式：用 Safari 打开微博桌面版的鸣潮超话，保存网页版 Cookie。
 * 定时模式：只签到鸣潮超话，不遍历其他已关注超话。
 *
 * 凭据只保存在 Quantumult X 的本地持久化存储中。
 */

const NAME = "鸣潮超话签到";
const STORE_KEY = "codex_weibo_mingchao_headers_v1";
const TOPIC_ID = "100808805d326c8383e31ed5f47088acce6b77";
const TOPIC_URL = `https://weibo.com/p/${TOPIC_ID}/super_index`;

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runTask()
    .catch((error) => notify("执行失败", error.message || String(error), TOPIC_URL))
    .finally(() => $done());
}

function captureRequest() {
  try {
    const headers = cleanHeaders($request.headers || {});
    const cookie = findHeader(headers, "cookie") || "";
    if (!/(?:^|;\s*)SUB=/.test(cookie)) {
      notify("未获取到登录 Cookie", "请先登录 weibo.com，并用 Safari 的桌面版网站打开鸣潮超话。", TOPIC_URL);
      return $done({});
    }

    const saved = {
      headers,
      capturedAt: new Date().toISOString(),
    };
    const ok = $prefs.setValueForKey(JSON.stringify(saved), STORE_KEY);
    notify(ok ? "凭据获取成功" : "凭据保存失败", "已保存微博网页版登录凭据");
  } catch (error) {
    notify("凭据获取失败", error.message || String(error));
  }
  $done({});
}

async function runTask() {
  const raw = $prefs.valueForKey(STORE_KEY);
  if (!raw) {
    notify("尚未获取凭据", "请先按 README 用 Safari 打开一次微博桌面版鸣潮超话。", TOPIC_URL);
    return;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (_) {
    throw new Error("本地凭据格式损坏，请重新获取");
  }

  const headers = cleanHeaders(saved.headers || {});
  const cookie = findHeader(headers, "cookie") || "";
  if (!cookie) throw new Error("微博 Cookie 为空，请重新获取");

  headers.Referer = TOPIC_URL;
  headers.Accept = "application/json, text/plain, */*";
  const xsrf = getCookie(cookie, "XSRF-TOKEN");
  if (xsrf) headers["X-XSRF-TOKEN"] = safeDecode(xsrf);

  const params = {
    ajwvr: "6",
    api: "http://i.huati.weibo.com/aj/super/checkin",
    texta: "签到",
    textb: "已签到",
    status: "0",
    id: TOPIC_ID,
    location: "page_100808_super_index",
    timezone: "GMT+0800",
    lang: "zh-cn",
    plat: "iPhone",
    screen: "1170*2532",
    __rnd: String(Date.now()),
  };
  const url = `https://weibo.com/p/aj/general/button?${toQuery(params)}`;
  const response = await $task.fetch({ url, method: "GET", headers });

  let result;
  try {
    result = JSON.parse(response.body || "{}");
  } catch (_) {
    throw new Error("微博未返回 JSON，Cookie 可能过期或触发登录验证");
  }

  const code = String(result.code || result.errcode || "");
  const message =
    (result.data && (result.data.tipMessage || result.data.alert_title)) ||
    result.msg ||
    result.errmsg ||
    "未知返回";

  if (code === "100000" || Number(result.result) === 1) {
    notify("签到成功", message, TOPIC_URL);
    return;
  }
  if (code === "382004" || /已签到/.test(message)) {
    notify("今天已签到", message, TOPIC_URL);
    return;
  }
  throw new Error(`${message}${code ? `（${code}）` : ""}`);
}

function cleanHeaders(input) {
  const result = {};
  const blocked = new Set([
    "content-length",
    "host",
    "connection",
    "accept-encoding",
    ":authority",
    ":method",
    ":path",
    ":scheme",
  ]);
  Object.keys(input || {}).forEach((key) => {
    if (!blocked.has(key.toLowerCase())) result[key] = input[key];
  });
  return result;
}

function findHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function getCookie(cookie, name) {
  const match = String(cookie).match(new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]*)`));
  return match ? match[1] : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function toQuery(object) {
  return Object.keys(object)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(object[key])}`)
    .join("&");
}

function notify(subtitle, body, url) {
  const options = url ? { "open-url": url } : undefined;
  $notify(NAME, subtitle, body, options);
}


