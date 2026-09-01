# 库街区 · 鸣潮签到脚本

## 文件

- `kurobbs_wuwa_signin.js`：Quantumult X 主脚本。
- `kurobbs_wuwa_signin.conf`：需要合并到 Quantumult X 配置的内容。

## 安装

1. 打开 [`kurobbs_wuwa_signin.conf`](./kurobbs_wuwa_signin.conf)，将其中的 `[rewrite_local]`、`[task_local]` 和 `[mitm]` 内容合并到正在使用的 Quantumult X 配置文件。
2. 在 Quantumult X 中生成、安装并信任 HTTPS 解密证书，开启重写和 MitM。
3. 保持 Quantumult X 接管网络，完全关闭并重新打开库街区 App。
4. 进入“鸣潮 → 签到”页面。收到“参数获取成功”通知即表示 Token、库街区 UID、角色 UID 和服务器 ID 已保存在本机。
5. 打开 Quantumult X 的任务列表，手动运行一次“库街区·鸣潮签到”进行测试。

## 工作逻辑

定时任务会先调用签到初始化接口查询 `isSigIn`：

- 今天已签到：只通知签到天数和奖励，不重复提交。
- 今天未签到：调用鸣潮签到接口，成功后再次查询状态进行确认。
- Token 失效：提示重新进入签到页抓取，不会盲目重复请求。

脚本只处理鸣潮游戏签到，不执行发帖、点赞、分享或库街区社区任务。

## 常见问题

### 打开签到页没有“参数获取成功”通知

- 确认 Quantumult X 正在接管网络。
- 确认已开启重写和 MitM，且证书已安装并信任。
- 检查 `api.kurobbs.com` 是否包含在 MitM hostname 中。
- 完全关闭库街区 App 后重新打开，再进入鸣潮签到页面。

### 提示 Token 失效

重新打开库街区 App 的鸣潮签到页。页面请求被拦截后，本机保存的参数会自动更新。

### 使用本地脚本

如不希望远程引用，可下载 `kurobbs_wuwa_signin.js`，放入 `iCloud Drive/QuantumultX/Scripts/`，再把配置文件中的两处 Raw 地址改成：

```text
kurobbs_wuwa_signin.js
```

不要把抓取到的 Token、请求日志或 Quantumult X 本地存储内容提交到 GitHub。

## 参考实现

- 自动抓取与定时任务的双模式结构参考 [`ZenmoFeiShi/Qx`](https://github.com/ZenmoFeiShi/Qx/blob/main/mixc_signin.js) 的一点万象脚本。
- 库街区接口、返回码和签到字段参考 [`yongyeym/AutoSign_QingLong`](https://github.com/yongyeym/AutoSign_QingLong/blob/main/kurobbs_sign.py) 及 [`TomyJan/Kuro-API-Collection`](https://github.com/TomyJan/Kuro-API-Collection/tree/master/API/encourage/signIn)。

## 声明

脚本仅供个人学习与自动化自用。库街区接口变化或风控策略可能导致脚本失效，请勿高频调用。
