/*
 * TapTap《鸣潮》活动签到（Quantumult X）
 *
 * 重写模式：打开 TapTap 签到活动页时，保存 dynamic_data 请求所需的本地凭据。
 * 定时模式：执行签到，并自动领取所有已解锁且尚未领取的签到礼包。
 *
 * 凭据只保存在 Quantumult X 的本地持久化存储中。
 */

const NAME = "TapTap 鸣潮签到";
const VERSION = "20261117.1";
const STORE_KEY = "codex_taptap_mingchao_request_v1";
const DEFAULT_EVENT_URL = "https://www.taptap.cn/events/game-sign/frndkdpd";

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runTask()
    .catch((error) => notify("执行失败", errorText(error)))
    .finally(() => $done());
}

function captureRequest() {
  try {
    const match = $request.url.match(/\/dynamic_data\/([^/?]+)/);
    if (!match) return $done({});

    const headers = cleanHeaders($request.headers || {});
    const saved = {
      activityCode: decodeURIComponent(match[1]),
      dynamicUrl: $request.url,
      headers,
      capturedAt: new Date().toISOString(),
    };

    const ok = $prefs.setValueForKey(JSON.stringify(saved), STORE_KEY);
    notify(ok ? "凭据获取成功" : "凭据保存失败", `活动代码：${saved.activityCode}`);
  } catch (error) {
    notify("凭据获取失败", errorText(error));
  }
  $done({});
}

async function runTask() {
  console.log(`[${NAME}] v${VERSION}`);
  const raw = $prefs.valueForKey(STORE_KEY);
  if (!raw) {
    notify("尚未获取凭据", "请先按 README 打开一次 TapTap 签到活动页。", DEFAULT_EVENT_URL);
    return;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (_) {
    throw new Error("本地凭据格式损坏，请重新打开活动页获取");
  }

  if (!saved.activityCode || !saved.dynamicUrl || !saved.headers) {
    throw new Error("本地凭据不完整，请重新打开活动页获取");
  }

  const query = saved.dynamicUrl.includes("?")
    ? `?${saved.dynamicUrl.split("?").slice(1).join("?")}`
    : "";
  const base = "https://www.taptap.cn/webapiv2/event/game-sign";
  const headers = cleanHeaders(saved.headers);
  const cookie = findHeader(headers, "cookie") || "";
  const xsrf = getCookie(cookie, "XSRF-TOKEN");
  if (xsrf && !findHeader(headers, "x-xsrf-token")) {
    headers["X-XSRF-TOKEN"] = safeDecode(xsrf);
  }
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  headers["X-Requested-With"] = "XMLHttpRequest";

  const smfp = findHeader(headers, "x-smfp") || "";
  let signBody = `activity_code=${encodeURIComponent(saved.activityCode)}`;
  if (smfp) signBody += `&smfp=${encodeURIComponent(smfp)}`;

  let signMessage = "";
  let signAccepted = false;
  try {
    const response = await fetchRequest({
      url: `${base}/check_in${query}`,
      method: "POST",
      headers,
      body: signBody,
    }, "签到");
    const result = unwrap(response.body);
    signAccepted = result.ok;
    signMessage = result.ok
      ? "签到成功"
      : result.message || `签到返回 HTTP ${response.statusCode}`;
  } catch (error) {
    signMessage = errorText(error);
  }

  let daily;
  try {
    const dynamicResponse = await fetchRequest({
      url: saved.dynamicUrl,
      method: "GET",
      headers: cleanHeaders(headers),
    }, "读取签到状态", 1);
    const dynamicResult = unwrap(dynamicResponse.body);
    if (!dynamicResult.ok) {
      throw new Error(`读取签到状态失败：${dynamicResult.message || "可能需要重新获取凭据"}`);
    }
    daily = dynamicResult.data && dynamicResult.data.daily_check_in;
    if (!daily) throw new Error("签到状态响应缺少 daily_check_in");
  } catch (error) {
    notify(signAccepted ? "签到已提交，状态待确认" : "签到结果待确认",
      `${signMessage}\n${errorText(error)}\n请稍后手动运行任务或打开活动页核对；本次未领取礼包。`, DEFAULT_EVENT_URL);
    return;
  }

  const days = Number(
    daily.check_in_log && daily.check_in_log.total_check_in_days
      ? daily.check_in_log.total_check_in_days
      : 0,
  );
  const awards = Array.isArray(daily.award_list) ? daily.award_list : [];
  const claimable = awards.filter((item) => Number(item.status) === 1 && item.award_id);
  const claimed = [];
  const claimFailed = [];

  for (const award of claimable) {
    let body = `award_id=${encodeURIComponent(award.award_id)}`;
    if (smfp) body += `&smfp=${encodeURIComponent(smfp)}`;
    try {
      const response = await fetchRequest({
        url: `${base}/v2/check-in-accept-award${query}`,
        method: "POST",
        headers,
        body,
      }, "领取礼包");
      const result = unwrap(response.body);
      if (!result.ok) {
        claimFailed.push(`${award.content || award.label || award.award_id}：${result.message || "领取失败"}`);
        continue;
      }

      const prize = result.data || {};
      const title =
        (prize.prize && prize.prize.title) ||
        award.content ||
        award.label ||
        String(award.award_id);
      const code = prize.code || prize.sn || "";
      claimed.push(code ? `${title}｜兑换码 ${code}` : title);
    } catch (error) {
      claimFailed.push(`${award.content || award.label || award.award_id}：${errorText(error)}`);
    }
  }

  const lines = [`累计签到：${days} 天`, signMessage];
  if (claimed.length) lines.push(`已领取：\n${claimed.join("\n")}`);
  if (claimFailed.length) {
    lines.push(`未能自动领取：\n${claimFailed.join("\n")}\n如提示验证码，请回活动页手动领取。`);
  }
  if (!claimable.length) lines.push("当前没有待领取礼包");
  notify("执行完成", lines.join("\n"), DEFAULT_EVENT_URL);
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

function unwrap(body) {
  let json;
  try {
    json = JSON.parse(body || "{}");
  } catch (_) {
    return { ok: false, message: "服务器未返回 JSON，登录凭据可能已过期" };
  }
  if (json.success === true) return { ok: true, data: json.data };
  const data = json.data || {};
  return {
    ok: false,
    data,
    message: data.msg || data.error_description || json.msg || json.message || "服务返回失败",
  };
}

function errorText(error) {
  let message = "";
  if (typeof error === "string") message = error;
  else if (error && typeof error === "object") {
    // QX 的 fetch 拒绝原因是 { error: "…" }，不一定是带 message 的 Error。
    message = [error.message, error.error, error.errorDescription, error.localizedDescription]
      .find((value) => typeof value === "string" && value.trim()) || "";
  }
  if (!message || message === "[object Object]") message = "未知错误（未返回错误描述）";
  const code = error && (error.errorCode !== undefined ? error.errorCode : error.code);
  if (code !== undefined && /^-?\d+$/.test(String(code))) message += `（错误码 ${code}）`;
  // 不展开整个错误对象；系统错误中附带的 URL/鉴权字段也不写入通知或日志。
  return message.replace(/https?:\/\/[^\s<>"']+/gi, "[请求地址已隐藏]")
    .replace(/\b(cookie|authorization)\s*[:=][^\r\n]*/gi, "$1=[已隐藏]")
    .replace(/\b([\w-]*(?:token|secret|session|sign|smfp)[\w-]*)\s*=\s*[^\s&,;]+/gi, "$1=[已隐藏]")
    .slice(0, 400);
}

async function fetchRequest(options, stage, retries = 0) {
  // 只重试读取状态；签到和礼包领取在超时后都可能已生效，不能重发。
  const maxRetries = options.method === "GET" ? Math.min(retries, 1) : 0;
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const response = await $task.fetch(options);
      console.log(`[${NAME}] ${stage}：HTTP ${response.statusCode}，耗时 ${Date.now() - started}ms`);
      return response;
    } catch (error) {
      const message = `${stage}请求失败：${errorText(error)}`;
      console.log(`[${NAME}] ${message}，耗时 ${Date.now() - started}ms`);
      if (attempt >= maxRetries) throw new Error(message);
      console.log(`[${NAME}] ${stage}：1 秒后重试一次`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

function notify(subtitle, body, url) {
  const options = url ? { "open-url": url } : undefined;
  $notify(NAME, subtitle, body, options);
}


