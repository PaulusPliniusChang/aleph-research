---
id: ALEPH-12
status: 已上传
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/1
pull_request: https://github.com/hapenia/aleph-research/pull/2
---

# 无战役时控制台显示快照读取失败，未展示空状态引导

## 问题

在 DSH 中没有战役时，`/api/aleph/snapshot` 返回 HTTP `404`，响应代码为 `aleph/no-campaign`。客户端轮询逻辑先依据非成功 HTTP 状态抛出异常，因此不会读取该错误码。控制台最终显示快照读取失败，而不是暂无战役的空状态和创建引导。

## 复现

1. 在 DSH 隔离环境启动插件，且不创建战役。
2. 打开控制台。
3. 观察快照接口与页面状态。

## 实际结果

快照接口返回 `404` 与 `aleph/no-campaign`；根据客户端轮询代码，页面会进入读取失败的处理流程。

## 预期结果

客户端将 `aleph/no-campaign` 识别为空状态并展示创建引导；其他 HTTP 错误继续展示读取失败。

## 验证

早期验证记录：DSH 隔离环境实测确认了服务端响应；当时的客户端处理结论来自代码检查，尚无浏览器验证记录。后续本地修改与浏览器实测结果见下文。

源码线索位于 `dsh-plugin/index.js` 的快照接口和 `dsh-plugin/client.js` 的 `useSnapshot()` 轮询逻辑。

## 本地修改与复测记录（2026-10-31）

首次实现按用户要求直接修改 `/home/paulus-chang/项目/aleph`，代码基于提交 `bd94c8c09f553c0bb92965704db9bf5c834cf749`，当时修改尚未提交。后续适配与提交记录见下文。

客户端先读取响应内容，只有 HTTP `404`、`ok: false` 和错误码 `aleph/no-campaign` 同时满足时，才显示空状态与创建提示。其他 HTTP 错误、业务错误、响应解析失败和网络中断继续显示读取失败。轮询失败时，已有战役快照仍保留，页面显示更新失败提示。

自动测试位于主仓库的 `tests/client-snapshot.test.mjs`，执行命令为 `npm test --prefix dsh-plugin`。测试替代了 React 状态钩子、DSH 客户端服务、网络请求和轮询时钟，验证状态变化及渲染文本。修改后的代码通过全部 20 项测试；相同测试在修改前的客户端代码上通过 14 项、失败 6 项。

实际环境为 DSH `0.2.2-alpha.2`，隔离配置名称为 `aleph-12`，浏览器地址为 `http://127.0.0.1:39872/`。浏览器插件在当前会话中不可用，因此使用 Playwright 和本机 Chrome 检查真实页面。桌面视口为 `1440 × 1000`，窄屏视口为 `390 × 844`。窄屏检查通过调整浏览器窗口完成，未使用实体手机。

| 测试方式 | 场景与结果 |
| --- | --- |
| 真实 DSH 接口与页面 | 无战役时，接口返回 `404` 和 `aleph/no-campaign`，页面显示“暂无战役快照”和 `aleph_start_campaign` 创建提示。刷新后结果相同。 |
| 真实 DSH 交互 | 点击“返回对话”后重新打开 Aleph，空状态正常显示。通过 Host 创建接口生成战役后，控制台在下一次轮询中自动显示战役；刷新后仍能读取战役。 |
| 浏览器请求拦截 | 其他 `404`、缺少错误码的 `404`、`401`、`403`、携带无战役错误码的 `500`、返回 HTML 的 `503`、无效 JSON、业务错误和网络中断均显示读取失败。 |
| 浏览器请求拦截 | 请求恢复后，页面自动显示真实战役；已有快照遇到 `503` 时仍显示旧数据与更新失败提示，后续成功请求清除提示。模拟无战役响应后，旧战役信息清除；恢复真实接口后，战役重新显示。 |
| 页面检查 | 页面标题正确，页面内容非空，没有框架错误遮罩，没有未捕获的脚本异常。控制台中的资源加载错误对应真实无战役 `404` 和主动模拟的失败请求。 |
| 窄屏检查 | 空状态文字正常换行，文档没有横向溢出。有战役页面能够显示，但部分卡片内容在窄屏下超出可见区域，本次快照错误处理修改未涉及布局调整。 |

浏览器脚本共通过 22 项行为断言，其中 7 项使用真实 DSH、14 项使用请求拦截、1 项检查页面运行情况。断言通过不表示窄屏下的全部战役卡片布局均已通过视觉验收。

本机临时证据目录为 `/tmp/aleph-12-dsh-validation/`。自动测试日志为 `before-tests.txt` 和 `after-tests.txt`，浏览器脚本为 `browser-tests.mjs`，结果为 `browser-results.json`，截图包括 `empty-desktop.png`、`empty-mobile.png`、`campaign-desktop.png`、`campaign-mobile.png`、`server-error.png` 和 `stale-campaign.png`。临时目录可能随系统清理而删除。错误请求场景由浏览器拦截生成，不代表实际 DSH 服务发生了相同故障。

## 提交前适配与复测（2026-10-31）

提交前同步了远端 `main` 的最新代码，基线为 `6688599`。最新服务端已经采用项目结构，没有项目时返回 `404` 和 `aleph/no-project`，创建提示使用 `aleph_init_project`。客户端因此同时识别 `aleph/no-project` 与旧版 `aleph/no-campaign`，其他失败响应仍进入错误处理。

新增测试已接入远端原有的测试命令。执行 `npm test --prefix dsh-plugin` 后，23 项客户端测试和现有的项目流程测试全部通过，共 24 项。语法检查和差异格式检查均通过。

最新代码再次安装到真实 DSH `0.2.2-alpha.2` 的隔离配置中，浏览器共通过 9 项检查：其中 5 项使用真实接口，覆盖无项目响应、刷新、窄屏空状态、错误后恢复以及清除旧项目显示；3 项通过请求拦截验证服务器错误、项目显示和保留旧快照；1 项检查页面标题、内容和运行异常。浏览器没有未捕获的脚本异常。项目成功响应在本次复测中由请求拦截生成，旧版真实战役创建测试保留在前一节。

本次复测证据位于 `/tmp/aleph-12-pr-validation/`，包含 `browser-tests.mjs`、`browser-results.json`、`empty-desktop.png` 和 `empty-mobile.png`。提交为 `ecfef49`，分支为 `fix/aleph-12-console-empty-state`，已推送到派生仓库 `PaulusPliniusChang/aleph-research`。拉取请求为 [#2](https://github.com/hapenia/aleph-research/pull/2)，目标分支为原仓库的 `main`。

## 验收条件

- 没有战役且接口返回 `aleph/no-campaign` 时，页面展示空状态与创建引导。
- 其他 HTTP 错误继续展示读取失败。
- 在实际 DSH 中打开无战役控制台，确认页面显示符合预期。

## 远端与维护记录

用户明确告知该议题已经提交到远端，并要求补入本地，当前状态据此设为“已上传”。此前通过 GitHub 公开接口核实了相同标题的远端议题：[议题 #1](https://github.com/hapenia/aleph-research/issues/1)。后续按用户要求创建了[拉取请求 #2](https://github.com/hapenia/aleph-research/pull/2)，尚未合并。当前状态仍由用户手动维护。
