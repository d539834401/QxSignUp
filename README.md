# Quantumult X · 鸣潮签到脚本

面向 Quantumult X 的《鸣潮》相关自动签到脚本。登录凭据仅保存在 Quantumult X 本机的 `$prefs` 中，不会提交到仓库或上传到第三方服务。

## 脚本列表

| 功能 | 脚本 | 配置 |
| --- | --- | --- |
| 库街区鸣潮游戏签到 | [`kurobbs_wuwa_signin.js`](./kurobbs_wuwa_signin.js) | [`kurobbs_wuwa_signin.conf`](./kurobbs_wuwa_signin.conf) |
| TapTap鸣潮活动签到及礼包领取 | [`taptap_wuwa_signin.js`](./taptap_wuwa_signin.js) | [`taptap_wuwa_signin.conf`](./taptap_wuwa_signin.conf) |
| 微博 App 超话签到（含鸣潮） | [`weibo_wuwa_supertopic_signin.js`](./weibo_wuwa_supertopic_signin.js)（抓取/签到双模式） | [`weibo_wuwa_supertopic_signin.conf`](./weibo_wuwa_supertopic_signin.conf) |

## 通用安装方法

1. 打开所需功能对应的 `.conf` 文件。
2. 将其中的 `[rewrite_local]`、`[task_local]` 和 `[mitm]` 内容合并到正在使用的 Quantumult X 配置文件；不要重复创建同名段落。
3. 在 Quantumult X 中生成、安装并信任 HTTPS 解密证书，开启重写和 MitM。
4. 按下方说明获取一次登录凭据。
5. 在 Quantumult X 的任务列表中手动运行对应任务进行测试。

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

本版本改为单脚本双模式：收到微博 App 请求时负责抓取，定时运行时负责签到。它会自动签到账号已关注的所有超话（包括鸣潮），不再依赖 Safari 的微博网页版 Cookie。由于微博接口使用 X-Validator 路径绑定，需要分别获取“关注列表”和“签到”两组请求信息。

1. 保持 Quantumult X 接管网络，合并 [`weibo_wuwa_supertopic_signin.conf`](./weibo_wuwa_supertopic_signin.conf)，安装并信任 MitM 证书。
2. 临时开启重写后，在微博 App 进入“我的 → 超话社区 → 我的 → 关注”，等待“已获取关注列表 Cookie”通知。
3. 进入任意超话并手动签到一次，等待“已获取签到 Cookie”通知。
4. 抓取完成后关闭重写规则，保留同一个脚本的定时任务；手动运行一次“微博·超话签到”测试，之后每天 08:00 自动执行。

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
- 库街区接口参考 [`yongyeym/AutoSign_QingLong`](https://github.com/yongyeym/AutoSign_QingLong/blob/main/kurobbs_sign.py) 与 [`TomyJan/Kuro-API-Collection`](https://github.com/TomyJan/Kuro-API-Collection/tree/master/API/encourage/signIn)。
- 微博 App 超话脚本基于 [`MaYIHEI/paperclip/app/weibotalk`](https://github.com/MaYIHEI/paperclip/tree/main/app/weibotalk)，并保留其双请求抓取流程。

## 声明

脚本仅供个人学习与自动化自用，不保证平台接口长期有效。
