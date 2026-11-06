# Quantumult X · 自动签到脚本

面向 Quantumult X 的个人自动签到脚本。登录凭据仅保存在 Quantumult X 本机的 `$prefs` 中，不会提交到仓库或上传到第三方服务。

## 脚本列表

| 功能 | 脚本 | 配置 |
| --- | --- | --- |
| 微信小程序未来荟每日签到 | [`wentiweilaihui_signin.js`](./wentiweilaihui_signin.js) | [`wentiweilaihui_signin.conf`](./wentiweilaihui_signin.conf) |
| 华润通 H5/微信签到 | [`huaruntong_signin.js`](./huaruntong_signin.js) | [`huaruntong_signin.conf`](./huaruntong_signin.conf) |
| 华润通·999 每日答题 | [`huaruntong_999_quiz.js`](./huaruntong_999_quiz.js) | [`huaruntong_999_quiz.conf`](./huaruntong_999_quiz.conf) |
| 汽水音乐签到（实验版） | [`qishui_signin.js`](./qishui_signin.js) | [`qishui_signin.conf`](./qishui_signin.conf) |
| 库街区鸣潮游戏签到 | [`kurobbs_wuwa_signin.js`](./kurobbs_wuwa_signin.js) | [`kurobbs_wuwa_signin.conf`](./kurobbs_wuwa_signin.conf) |
| TapTap鸣潮活动签到及礼包领取 | [`taptap_wuwa_signin.js`](./taptap_wuwa_signin.js) | [`taptap_wuwa_signin.conf`](./taptap_wuwa_signin.conf) |
| 微博 App 超话签到（含鸣潮） | [`weibo_wuwa_supertopic_signin.js`](./weibo_wuwa_supertopic_signin.js)（新版 flowlist 接口） | [`weibo_wuwa_supertopic_signin.conf`](./weibo_wuwa_supertopic_signin.conf) |
| 亚朵酒店 App 每日签到和抽奖 | [`yaduo_signin.js`](./yaduo_signin.js) | [`yaduo_signin.conf`](./yaduo_signin.conf) |
| 华住会 App/微信小程序每日签到 | [`huazhu_signin.js`](./huazhu_signin.js) | [`huazhu_signin.conf`](./huazhu_signin.conf) |
| 小黑盒 iOS App 每日签到（待实机验证） | [`heybox_signin.js`](./heybox_signin.js) | [`heybox_signin.conf`](./heybox_signin.conf) |
| 中国移动全国版 App 签到有礼（待实机验证） | [`cmcc_signin.js`](./cmcc_signin.js) | [`cmcc_signin.conf`](./cmcc_signin.conf) |
| 顺丰速运 App / 微信小程序每日签到（待实机验证） | [`sfexpress_signin.js`](./sfexpress_signin.js) | [`sfexpress_signin.conf`](./sfexpress_signin.conf) |

## 通用安装方法

1. 打开所需功能对应的 `.conf` 文件。
2. 将其中的 `[rewrite_local]`、`[task_local]` 和 `[mitm]` 内容合并到正在使用的 Quantumult X 配置文件；不要重复创建同名段落。
3. 在 Quantumult X 中生成、安装并信任 HTTPS 解密证书，开启重写和 MitM。
4. 按下方说明获取一次登录凭据。
5. 在 Quantumult X 的任务列表中手动运行对应任务进行测试。

## 顺丰速运 App / 微信小程序每日签到

采用本仓库单文件抓取/定时双模式，处理顺丰的 **新版签到日历** 和 **普通签到礼包** 两项独立活动。App 或微信“顺丰速运”小程序任选一个抓取，使用实际请求中的 Cookie、User-Agent、platform 和 channel，不需要 Python、青龙、BoxJS 或第三方取码服务。

1. 将 [`sfexpress_signin.conf`](./sfexpress_signin.conf) 的 `[rewrite_local]`、`[task_local]`、`[mitm]` 三段合并到现有 QX 配置，追加 `mcs-mimp-web.sf-express.com`，开启重写与 MitM 并安装、信任证书。配置直接引用本仓库 `main` 的远程脚本。
2. 登录顺丰速运 App 或微信“顺丰速运”小程序，进入 **“我的 → 积分 / 签到”** 页面。收到 **“参数获取成功”** 后关闭抓取规则，保留定时任务。抓取只保存参数，不主动请求签到；页面本身可能自动签到。
3. 在 QX 中手动运行“顺丰速运签到”，随后在顺丰页面核对当天状态。之后每天设备本地时间 **08:35** 执行，脚本的签到日期按北京时间判断。首次抓取若页面已自动签到，需次日先运行任务再打开页面验证。

新版日历先调用 `getTodaySign`：当天已签时跳过提交；未签才调用一次 `sign`，随后再查状态确认。`3400002` 已签到响应、提交超时或 `SUCCESS` 都不会替代最终状态核验。普通签到单独调用 `automaticSignFetchPackage`，按官方页面使用的 `hasFinishSign` 标志区分本次已签、当天已签和礼包待领；仅在明确待领时调用一次领取接口。这两项不是失败重试关系，不会在一条超时后改走另一条来重发同一签到。普通签到没有额外的独立状态查询，是否已签以明确返回标志为准；奖励是否到账以顺丰页面为准。

通知分别显示两项结果和可查询到的积分余额。积分变化只表示两次查询之间的余额变化，可能包含期间其它操作，不声称全部来自本次签到。只完成一项时显示“部分签到已确认”；未知字段、非 JSON、网络超时、业务拒绝和登录失效分别处理。脚本只执行每日签到及其明确待领礼包，不包含寄件、邀请、浏览任务、积分兑换、蜂蜜或会员日抽奖。

凭据键为本机 `$prefs` 的 `sfexpress_signin_profile_v1`；最近结果为 `sfexpress_signin_status_v1`。单账号抓取会完整替换旧参数，不合并不同账号的 Cookie。会话过期或重新打开小程序导致旧会话失效时，临时开启抓取并重新进入积分页即可更新；只有服务器实际返回 `Set-Cookie` 时才保存续发会话，不保证长期免维护。保存时会检查运行期间参数是否已被新抓取替换。不要公开上述本机数据。

如果没有抓取通知，请确认相关请求经过 QX，且出现 `mcs-mimp-web.sf-express.com` 的登录或积分/签到接口；仅取得其它域名的登录数据不代表已取得本脚本所需会话。远程脚本加载失败时，可下载 [`sfexpress_signin.js`](./sfexpress_signin.js) 到 QX 的 `Scripts/`，再把抓取规则与任务中的 JS 地址都改为本地文件名。请求仅发往顺丰这一域名，关闭自动跳转和自动 Cookie 管理，建议 QX build 934 或更新版本。

**验证范围：离线模拟 QX、MD5 与 Node 标准库交叉验证，以及 2026-11-05 顺丰公开页面/静态资源的协议核对；尚未使用真实账号在 iPhone/QX 验证登录、签到和到账。** 测试命令：`node --test tests/sfexpress_signin.test.js`。

接口资料参考 [`yang7758258/ohhh_QL-Script @ 74fba0ca`](https://github.com/yang7758258/ohhh_QL-Script/blob/74fba0ca5619a4ec074492ceb7a8a7a2ca2facbc/sf_qinglong.js)（顺丰脚本最后修改 2026-11-01）、[`haoyu592/DSbox @ 6bc18d90`](https://github.com/haoyu592/DSbox/blob/6bc18d90cf05c30bb39b4bb638cc443594790474/Scripts/sfsy_sign.js)（最后修改 2026-10-30），以及[顺丰官方公开页面](https://mcs-mimp-web.sf-express.com/superWelfare)引用的前端资源。本脚本独立编写请求、抓取和状态判断，MD5 原语复用本仓库实现；未直接复制上述第三方脚本源码。

## 中国移动 App 签到有礼

面向全国版中国移动 App 的 `mark31` 签到活动，按本仓库单文件抓取/定时双模式实现。每天设备本地时间 **08:23** 执行，签到日期按北京时间计算。凭据保存在本机 `$prefs`，不需要 Python、青龙、BoxJS 或远程签名服务。

1. 打开 [`cmcc_signin.conf`](./cmcc_signin.conf)，用其中带 `?v=20261106.1` 的地址替换旧抓取规则和旧任务地址。保留一份规则和一个任务，避免旧规则优先命中。任务日志应显示 **版本 `20261106.1`**。
2. **已经收到旧版“已保存部分参数”通知的用户，先保留本机数据并直接运行新版任务。** 新版会读取已有冷启动模板补齐登录请求，不再强制等待签到页第二次抓取；不需要清空 QX 持久化数据。
3. 首次配置或旧数据不完整时，合并配置三段，追加两个 MitM 域名，开启重写、MitM 并安装、信任证书。**完全关闭并重新打开中国移动 App**，抓取原生 `autoLogin` 加密登录模板。模板中含真实手机号、省市、App 版本和加密登录参数时，收到“参数获取完整”后即可关闭抓取规则并运行任务。
4. `appTokenLogin` 抓取规则仍作为兼容入口保留，但不是必须触发的第二步。签到页复用已有登录状态时，可能根本不发这个请求。缺少省市或版本时，新版会具体列出缺失字段，再按提示重新抓取。抓取脚本只保存数据，不主动登录或签到。

2026-11-06 修复了旧版对第二组参数的硬依赖。由冷启动模板的 `tel`、`prov`、`city`、`cv` 生成现行 SSO 入参，其中手机号按官方页面逻辑转为十六进制；不填充虚构的省、市或 App 版本。运营商码未在模板中提供时使用上游中国移动协议值 `002`，真正捕获的 SSO 参数优先保留。原生 Cookie 缺失时，任务使用本人加密模板先建立 App 会话，再登录签到活动；仍受一分钟恢复限流和每任务一次恢复限制。

首次抓取如果 App 已自动签到，当天只能验证状态查询，需次日先运行任务再打开 App 核对。

如果 QX 无法加载远程脚本，可将 [`cmcc_signin.js`](./cmcc_signin.js) 保存到 `iCloud Drive/Quantumult X/Scripts/` 或“我的 iPhone/Quantumult X/Scripts/”，再将两条抓取规则和定时任务中的 JS 地址都改为本地文件名 `cmcc_signin.js`。

任务先查询当天状态，未签到才提交一次，再次查询确认后才报告“签到已确认”。提交超时、5xx 或业务响应为 `SUCCESS` 均不会直接当作成功；无法查到已签记录时提示“结果待确认”，本次不重发。确认已签后，最多领取四项服务端列出的免费累计/连签奖励；单日奖品和累计奖励分别报告，领取异常不覆盖已确认的签到结果。设置本机持久化键 `cmcc_signin_claim_awards` 为 `false` 可关闭累计奖励代领。

短期活动 Cookie 仅缓存 20 分钟。过期后用捕获的 App 票据重新换取活动会话；票据失效时，尝试用本人 App 的冷启动模板重新签名请求恢复会话，每次任务最多一次，并设置一分钟限流保护。没有冷启动模板时，仍可在票据有效期内运行，但失效后需要重新抓取。此恢复能力依据上游公开实测，不保证所有省份、设备和未来 App 版本长期有效。服务端提示其它设备会话占用时，需要本人在 App 重新登录后重新抓取。

单账号配置键为 `cmcc_signin_profile_v1`，包含票据、设备模板、手机号和短期 Cookie；最近结果为 `cmcc_signin_status_v1`。切换手机号会替换旧账号参数，避免把两个号码的登录参数拼在一起。请勿公开这两个键。请求只发送到 `wx.10086.cn` 和 `client.app.coc.10086.cn`，关闭自动跳转与自动 Cookie 管理；建议使用支持 `opts.auto-cookie` 的 QX build 934 或更新版本。若 App 因证书校验而无法抓取，或 QX 无法与旧 TLS 网关握手，需要进一步实机诊断。

**验证范围：55 项离线模拟 QX 与密码学测试，以及 2026-11-06 未登录 SSO 入口检查；尚未用真实账号在 iPhone/QX 完成签到。** 测试包含旧版冷启动部分参数自动迁移、无 Cookie 建立会话、缺失字段提示、账号隔离及额外查询参数兼容。未登录入口确认仍使用 `appTokenLogin`，并下发 `enableJwtLogin=false`，因此没有采用旧版“JWT 可永久自动续期”的假设。

接口资料参考 [`mli84/cmcc-auto-checkin @ a34f305e`](https://github.com/mli84/cmcc-auto-checkin/tree/a34f305eeb83b1327444f56fce434276e2c6d98c) 的 `cmcc_sign.py`、`cmcc_session.py`。本实现独立编写 JavaScript 请求、状态核验和密码学逻辑，不复制上游 Python 源码。测试：`node --test tests/cmcc_signin.test.js`。

2026-11-05 选型记录：该仓库 10 月 26–30 日仍有会话恢复修复；原 `yupaiLy/cmcc-auto-checkin` 已归档，`1009394958/10086-checkin` 简介已标记“用不了”。`curtinp118/Scripthub` 虽有原生 QX 版本，但移动脚本最近修改为 5 月 31 日，采用短期活动 Cookie，不能仅凭整库近期更新判断长期可用。

## 未来荟每日签到

保持 Quantumult X 接管网络，合并 [`wentiweilaihui_signin.conf`](./wentiweilaihui_signin.conf)，然后完全关闭并重新打开微信小程序“未来荟”。首页加载时会请求会员卡详情，脚本从该请求中保存 `Wechat JWT`、`appId`、项目 UUID 及必要请求头；收到“参数获取成功”通知后即可运行任务。

任务每天 08:05 运行，先调用签到记录接口。今日已经签到时只通知当前周期签到天数与积分；未签到时才提交签到，然后重新查询签到记录与积分进行确认。JWT 失效后重新打开未来荟小程序即可刷新，不需要为了抓取凭据重复点击签到按钮。

本脚本使用的是当前未来荟接口 `wlhmobile.crland.com.cn`，不是旧版“春茧”接口 `program.springcocoon.com`。接口已于 2026-09-05 使用 iPhone 上的未来荟小程序实时验证。

## 亚朵酒店签到（App 接口）

合并 [`yaduo_signin.conf`](./yaduo_signin.conf)，开启 Quantumult X 的重写和 MitM，并确认已安装、信任 HTTPS 解密证书。

首次获取参数时，暂时保留 `.conf` 中的 `script-request-header` 规则，然后打开亚朵酒店 App，进入“我的 → 积分/每日签到”，手动加载或签到一次。脚本会跳过 OPTIONS 预检，只保存带有真实 Atour 动态签名和极验参数的 GET 请求，再保存到 Quantumult X 本机的 `$prefs`，对应键名为 `adjd_url` 和 `adjd_header`；收到“Token获取成功”通知后，关闭这条抓取规则，保留定时任务。

任务每天 08:08 运行。脚本会先执行签到接口，并按返回结果区分：

- `未获取到Token/登录参数`：本机没有完整的 `adjd_url`、`adjd_header`，或抓到的请求中没有识别到登录凭据。
- `Token已失效`：接口返回 401/403、登录过期或 Token/Cookie 失效。
- `今日已签到`：接口返回“已签到、重复签到、请明日再来”等提示，或返回明确的当日已签到字段。
- `签到失败`：接口返回其它错误、HTTP 异常、响应无法解析或返回码不成功。

签到成功或当天已经签到后，脚本才会执行六宫格抽奖；抽奖结果单独报告为 `抽奖成功`、`今日已抽奖` 或 `抽奖失败`，不会把抽奖失败误报成签到失败。抽奖格默认随机选择 0–5；如需固定格子，可在 Quantumult X 持久化数据中设置 `adjd_draw` 为 `0` 到 `5`。当前这份公开脚本没有额外的独立状态查询，是否“今日已签到”以签到接口的返回字段或提示为准。首次安装或接口更新后，请先手动运行任务并以亚朵页面的积分/签到状态为准。

本脚本来源于 [Sliverkiss 的 `adjd.js`](https://gist.githubusercontent.com/Sliverkiss/2e2093bfd5f524d58c8e90fed9beacfd/raw/e399523e428f3c173ec4b95c892725006c3128ff/adjd.js)，作者注释标注的是亚朵酒店 App，接口域名为 `miniapp.yaduo.com`。它不是专门验证过的微信小程序脚本；如果从微信小程序无法捕获同一请求，请不要把“参数获取成功”当作微信小程序可用。

## 华住会每日签到

本脚本将 [Dimlitter/huazhu-auto-checkin](https://github.com/Dimlitter/huazhu-auto-checkin) 的 Python HTTP 签到逻辑移植到 Quantumult X，使用 `appgw.huazhu.com/game/sign_in` 和 `/game/sign_header`。无需 Python、Docker 或 BoxJS。

1. 合并 [`huazhu_signin.conf`](./huazhu_signin.conf)，开启重写和 MitM，安装并信任 HTTPS 解密证书。
2. 打开华住会 App 或微信“华住会”小程序，登录并进入签到页。脚本只从命中请求的 Cookie 中读取 `userToken`，忽略 OPTIONS 预检。若 App 证书校验阻止抓取，请尝试微信小程序；登录请求中没有 `userToken` 时仍需进入签到页。
3. 收到“Token获取成功”通知后关闭两条抓取规则，保留定时任务，在 QX 任务列表手动运行“华住会签到”。抓取本身只保存请求头，不主动调用签到接口。

任务每天本地时间 **09:05** 运行。先查询当天状态，已经签到时只查询积分与累计天数；未签到才发起签到，然后再次查询确认。服务端未明确确认当日已签时会显示“结果待确认”，请核对 App/小程序状态。HTTP 401/403 或业务登录失效会提示重新抓取；其它业务失败、网络错误、限流和响应格式变化单独报告。此移植已通过模拟 QX 环境测试，**尚未使用真实华住会账号验证**；上游作者的实测不等于本移植已完成实机验证。

单账号 Token 保存在本机 `$prefs` 的 `huazhu_signin_token`，User-Agent 保存在 `huazhu_signin_user_agent`。如需多个账号，可在 QX 本地持久化数据中设置 `huazhu_signin_tokens`，只填写各账号的 `userToken` 值，以 `&` 或换行分隔。多账号列表优先于自动抓取的单账号 Token；重新抓取不会覆盖手动列表。清空多账号键后恢复单账号模式。多账号按顺序运行，总时限约 45 秒，未执行完的账号会明确提示。

服务器实际通过 `Set-Cookie` 续发 `userToken` 时，脚本会为对应账号保存新值；不会覆盖执行期间被用户或抓取脚本更新的凭据。没有续发 Cookie 时不会声称已续期，Token 过期仍需重新抓取。为适应 QX 任务时限，原版长时间错峰与重试改为最多一次短重试；`Retry-After` 要求等待超过 3 秒时留待下次运行。多账号请求关闭自动 Cookie 管理，建议使用支持 `opts.auto-cookie` 的 QX build 934 或更新版本。

来源固定为上游提交 [`c4a4497`](https://github.com/Dimlitter/huazhu-auto-checkin/tree/c4a4497cbb52274cf1b2251f30342e447c48e08d)，华住会移植脚本遵循 GPL-3.0，保留原作者署名与 [许可证全文](./licenses/huazhu-GPL-3.0.txt)。测试命令：`node --test tests/huazhu_signin.test.js`。

## 小黑盒每日签到（iOS / QuanX）

配置中的 Raw 地址使用 `main` 主分支。脚本沿用本仓库的单文件抓取/定时双模式；不需要 Node.js、Docker、BoxJS 或第三方签名服务。

1. 将 [`heybox_signin.conf`](./heybox_signin.conf) 合并到现有配置，开启重写与 MitM，安装并信任自己的证书。把 `api.xiaoheihe.cn` 追加到现有 hostname 列表，不要覆盖其它域名。
2. 保持小黑盒 App 已登录，进入 **“我的 → 签到”**，等待“参数获取成功”通知。只需加载页面，抓取脚本不主动签到。只接受包含实际 `device_id`、黑盒 ID、App/系统版本和 `pkey` 的 iOS 请求；不会用虚构设备参数补全不完整请求。
3. 收到通知后关闭这条抓取规则，保留定时任务，在 QuanX 任务列表手动运行“小黑盒签到”。之后每天设备本地时间 **08:20** 运行，判断“今天”和钱包日期统一使用北京时间。

凭据保存在本机 `$prefs` 的 `heybox_signin_profile_v1`；最近结果保存在 `heybox_signin_status_v1`，包含 `signed`、`rewardConfirmed` 和日期。一个捕获配置对应一个账号，切换账号会替换配置。不要公开这两个键、Cookie 或请求截图。

任务先查询当日状态和最近 30 条 H 币明细。已确认今天签到或已有“完成签到任务”入账时跳过提交；未签到才提交一次，随后轮询状态并再次核对流水。结果分别显示：

- **签到成功**：已查到当日“完成签到任务”的正数 H 币入账；显示的是当天签到流水合计，不是承诺每次固定奖励。
- **今日已签到**：已确认当日状态或入账，本次不重复提交；奖励未能核验时会单独说明。
- **已签到，奖励待确认 / 签到结果待确认**：状态已签但没有确认入账，或提交后仍在处理中、超时、缺少日期、跨日。不会将这些结果记为成功；最近 30 条中没有签到明细也不能证明没有发奖。
- **登录失效 / 签到未完成**：凭据过期、接口拒绝、限流或协议变化。登录失效后重新开启抓取并进入签到页，更新后关闭抓取规则。

提交超时或上游 5xx 时只查询结果，不自动重发签到。全任务约 40 秒预算，所有请求仅发往 `api.xiaoheihe.cn`，关闭自动跳转和自动 Cookie 管理，不输出原始响应、URL 或凭据。建议使用支持 `opts.auto-cookie` 的 QX build 934 或更新版本。

**验证范围：离线模拟 QuanX 和密码学测试，不包含真实账号签到。** iOS 签名参考 MaYIHEI 的 iOS 1.3.397 实现；新 App 版本仍需实机核对。首次应在当天尚未打开小黑盒、尚未签到时运行定时任务，再打开 App 核对签到天数及钱包入账；若为了首次抓取已经自动签到，需要到次日验证。当前仅处理签到，不包含分享、抽奖、领券和发帖。

实现及纯 JS 密码学原语基于 [`MaYIHEI/paperclip @ f320e2ac`](https://github.com/MaYIHEI/paperclip/tree/f320e2ac257b2b713fecd1c66356667eaafb2948/app/heybox)，签到日期、轮询和钱包核验参考 [`Cansiny0320/heybox-daily @ 3e6f3bf`](https://github.com/Cansiny0320/heybox-daily/tree/3e6f3bf84b8d424093b4db834361dbbec3300b90)。保留 [MaYIHEI](./licenses/heybox-paperclip-MIT.txt)、[Cansiny0320](./licenses/heybox-cansiny-MIT.txt) 与 Web 签名原作者 [XiaHouSheng](./licenses/heybox-core-MIT.txt) 的 MIT 许可。测试：`node --test tests/heybox_signin.test.js`。

## 华润通每日签到

合并 [`huaruntong_signin.conf`](./huaruntong_signin.conf)，开启重写和 MitM 后打开[华润通签到页](https://cloud.huaruntong.cn/web/online/#/signIn)。页面会把登录信息写入 `localStorage.uInfo`；脚本通过同源探测请求获取 token 并仅保存到 QX 本地 `$prefs`，不会把 token 写入仓库或第三方服务。

任务每天 07:15 运行，先调用 `/api/points/queryWeekSignin` 判断当天状态；未签到才调用 `/api/points/saveQuestionSignin`，随后复核签到天数和积分。请求体使用华润通当前 `crypto4mid` 库（HMAC-MD5、AES-CBC、RSA-OAEP），并实时验证了 `mid.huaruntong.cn` 的成功签到响应。

首次抓取如果没有通知，请完全关闭微信页面后重新打开签到链接；确保 MitM 中包含 `mid.huaruntong.cn`、`cloud.huaruntong.cn` 和 `activity.huaruntong.cn`。

## 华润通·999 每日答题

合并 [`huaruntong_999_quiz.conf`](./huaruntong_999_quiz.conf)，开启重写和 MitM 后，在微信中搜索并打开小程序“999会员中心”，进入“健康答题”或“每日一题”页面。脚本会从题目请求中保存该活动独立使用的 `token`、手机号和必要请求头；它与普通华润通签到的 token 不是同一份凭据。

任务每天 07:25 运行。脚本先获取当天题目，从接口返回选项的 `right` 标记中提取正确答案，再调用答题接口提交；已经完成、登录失效、没有题目或接口异常都会单独通知。活动入口和名称可能随运营调整，抓不到参数时请检查网络活动中是否出现 `api4.jiankangyouyi.com`。

## 汽水音乐签到（实验版）

网上流传的 `music-api.douyin.com/task/signIn` 当前并不存在，不能作为签到接口。现有公开规则只能确认汽水音乐签到入口使用真实的 `/luna/treasure/` 接口，因此本版本采用抓取重放：合并 [`qishui_signin.conf`](./qishui_signin.conf)，进入汽水音乐“我的 → VIP 天天送”，手动点击当天日期签到一次，脚本会保存真实的签到/领取请求，之后每天 07:35 重放。

脚本会排除广告、视频、埋点和红包雨请求，只处理签到候选请求。如果服务端返回 Cookie 失效或短时设备签名过期，会明确通知重新抓取。该版本尚未完成 iPhone 实机签到验证，在验证前不要把“请求执行成功”视作奖励一定到账，应以汽水音乐页面状态为准。

## 库街区鸣潮签到

保持 Quantumult X 接管网络，完全关闭并重新打开库街区 App，进入“鸣潮 → 签到”页面。收到“参数获取成功”通知后即可运行任务。

定时任务会先查询今日签到状态：已经签到时不会重复提交；尚未签到时自动签到并再次查询确认。脚本只处理鸣潮游戏签到，不执行发帖、点赞、分享或库街区社区任务。

Token失效时，重新进入库街区 App 的鸣潮签到页即可刷新本地凭据。

## TapTap鸣潮活动签到

保持 Quantumult X 接管网络并登录 TapTap，然后打开当前《鸣潮》签到活动页。页面加载并出现“凭据获取成功”通知即可，无需为了抓取凭据重复点击签到。

当前3.6活动入口：

<https://www.taptap.cn/events/game-sign/frndkdpd>

任务会自动识别活动代码、执行签到，并尝试领取所有已经解锁但尚未领取的签到礼包。后续版本更换活动页面时，打开新活动页一次即可更新本地活动代码和凭据。

如果领取接口要求腾讯验证码，脚本只保留签到结果并通知返回活动页手动领取，不会尝试绕过验证码。礼包和兑换码均有有效期及库存限制，以活动页面为准。

## 微博 App 超话签到（含鸣潮）

本版本按近期微博 App 接口调整为双请求抓取模式：`weibo_wuwa_supertopic_signin.js` 负责抓取兼签到。它会自动签到账号已关注的所有超话（包括鸣潮），不依赖 Safari 的微博网页版 Cookie。由于微博接口使用 X-Validator 路径绑定，需要分别获取“关注列表”和“签到”两组请求信息。关注列表使用 `/2/flowlist`，仅保存请求参数 `flowId` 或 `containerid` 等于 `232478_-_super_topic_followed` 的请求；已移除 `container_timeline_topicpage/topicsub` 和 `cardlist` 捕获支持。签到捕获只匹配包含 `active_checkin` 的 `page/button` 请求。定时签到会使用纯 `fid`，不会携带微博推荐流的 `_-_recommend` 标记，避免触发关注动作。

1. 保持 Quantumult X 接管网络，合并 [`weibo_wuwa_supertopic_signin.conf`](./weibo_wuwa_supertopic_signin.conf)，安装并信任 MitM 证书；如果之前添加过旧版微博规则，请先删除重复规则，最终只保留一条使用 `script-request-body` 的 `flowlist` 列表规则和一条仅匹配 `active_checkin` 的 `page/button` 规则。
2. 临时开启重写后，在微博 App 进入“我的 → 超话社区 → 我的 → 关注”，下拉刷新，等待“已捕获关注列表请求”通知。
3. 进入任意超话并手动签到一次，等待“已捕获超话签到请求”通知。若之前所有超话都已签到，可先关注一个新超话再手动签到。
4. 抓取完成后关闭重写规则，保留定时任务；手动运行一次“微博·超话签到”测试，之后每天 08:00 自动执行。

新版关注列表标识位于 POST 请求体，必须使用 `script-request-body`；脚本保留真实请求体，不再使用旧版默认参数。升级时请同时更新 JS 和重写规则，并重新刷新关注列表；若本地仍保存旧接口凭据，任务会提示重新获取。若 QX 未执行远程请求重写，可将脚本下载到 `iCloud Drive/Quantumult X/Scripts/` 或“我的 iPhone/Quantumult X/Scripts/”，再把规则末尾改成本地文件名。

若已保存旧列表请求且 URL 含 `gsid`，任务会复用其登录参数查询新版 `/2/flowlist`，使用已验证的关注列表参数，并在得到正常列表结构后保存迁移结果。迁移不调用旧接口；登录参数过期时仍需重新捕获。

诊断版 `v20261003.3` 在重写命中 `/2/flowlist` 时记录请求体类型和长度；缺少请求体会明确通知，不含关注列表标识则记录忽略原因。手动任务也输出版本号。任务日志中的版本号仅代表任务使用的脚本，不能证明重写脚本缓存已同步。

如果仍然没有第一条通知，请检查重写是否命中、脚本是否加载成功和系统通知权限：请确认 MitM 中包含 `api.weibo.cn` 和 `mapi.weibo.com`，并检查微博请求是否经过 Quantumult X。若出现“已捕获关注列表请求”但没有第二条，必须在重写保持开启时真正点击超话页的“签到”按钮，而不是只打开超话页面。

如果抓取失败或 X-Validator 过期，清空 QX 本地持久化数据后重新完成以上两次抓取。关注超话较多时应降低执行频率，避免触发风控。

## 常见问题

### 打开页面没有凭据获取通知

- 确认 Quantumult X 正在接管网络。
- 确认重写和 MitM 已启用，证书已安装并信任。
- 检查对应域名已追加至现有 `[mitm]` 的 `hostname`。
- 完全关闭相关 App 或浏览器页面后重新打开。

### 使用本地脚本

如果不希望使用 Raw 远程地址，可以下载对应 `.js` 文件，放入 `iCloud Drive/Quantumult X/Scripts/` 或“我的 iPhone/Quantumult X/Scripts/”，然后把 `.conf` 中的 Raw 地址换成本地脚本文件名。

## 安全与使用说明

- 不要把抓取到的Token、Cookie、请求日志或Quantumult X持久化存储内容提交到GitHub。
- 自动化接口可能随平台更新而变化；首次安装或更新后请先手动运行测试。
- 不要高频执行任务；使用前请自行确认并遵守库街区、TapTap、微博及游戏活动规则。
- TapTap同类型渠道礼包兑换码通常每个游戏角色只能兑换一次。

## 参考实现

- 自动抓取与定时任务的双模式结构参考 [`ZenmoFeiShi/Qx`](https://github.com/ZenmoFeiShi/Qx/blob/main/mixc_signin.js)。
- 未来荟接口参考 [`Cat-zaizai/ZaiZaiCat-Checkin`](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/huaruntong/wentiweilaihui)，并通过当前小程序请求实时复核。
- 华润通微信版接口参考 [`Cat-zaizai/ZaiZaiCat-Checkin`](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/huaruntong/huaruntong_wx)，并通过当前 H5 签到请求实时复核。
- 华润通·999 每日答题接口参考 [`Cat-zaizai/ZaiZaiCat-Checkin`](https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/huaruntong/999)，Quantumult X 版本会自动抓取该活动独立的 token 和手机号。
- 汽水音乐真实签到入口路径参考 [`BOBOLAOSHIV587/Rules`](https://github.com/BOBOLAOSHIV587/Rules/tree/main/JS/SodaMusic)，任务操作流程参考 [`miemiegy/fuckqishuishui-miemie`](https://github.com/miemiegy/fuckqishuishui-miemie)。
- 库街区接口参考 [`yongyeym/AutoSign_QingLong`](https://github.com/yongyeym/AutoSign_QingLong/blob/main/kurobbs_sign.py) 与 [`TomyJan/Kuro-API-Collection`](https://github.com/TomyJan/Kuro-API-Collection/tree/master/API/encourage/signIn)。
- 微博 App 超话脚本基于 [`MaYIHEI/paperclip/app/weibotalk`](https://github.com/MaYIHEI/paperclip/tree/main/app/weibotalk)，并保留其双请求抓取流程。
- 华住会签到移植自 [`Dimlitter/huazhu-auto-checkin`](https://github.com/Dimlitter/huazhu-auto-checkin)，保留其 Cookie 鉴权、状态查询、多账号与服务器续发 Token 保存逻辑；QX 适配使用 `$task.fetch`、`$prefs` 和 `$notify`。

## 声明

脚本仅供个人学习与自动化自用，不保证平台接口长期有效。
