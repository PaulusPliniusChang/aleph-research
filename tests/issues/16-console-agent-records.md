---
id: ALEPH-16
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/22
pull_request: null
---

<!-- 本地管理说明：用户于北京时间 2026-10-31 17:54 接纳该候选，要求先登记为“可疑”。B 已在最新上游 785a7e9c 完成 41 个自动行为检查点与真实 DSH 浏览器核查，确认该问题仍然存在。GitHub 正文应移除管理头及本段前导注释，本地文件保留完整内容。 -->

# 控制台读取代理列表的位置错误，已有代理可能显示尚未运行

## 当前情况

Host 保存研究代理、Composer 和 InfraOptimizer 的记录，并在快照顶层的 `agents` 字段返回角色、状态、子会话编号、分支、更新时间和摘要。控制台已有代理表格，但页面把快照中的 `project` 对象传入表格；该对象不含代理列表。

表格读取传入对象的 `.agents` 字段时，只能得到缺失值，随后使用空数组并显示“尚未运行 Composer 或 InfraOptimizer。”即使后端已经存在正确记录，页面也可能无法展示。建议优先级为 P2。

最新上游 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 已完成自动和实际 DSH 核查。自动检查包含 41 个有效行为点，其中 17 个通过、24 个失败；真实浏览器的 23 项观察全部符合复现条件。上游议题为 [#22](https://github.com/hapenia/aleph-research/issues/22)，修复拉取请求待补充。

## 使用例子

项目已经启动 InfraOptimizer，Host 保存了一条角色为 `infra`、状态为 `running` 的记录。打开 Aleph 控制台后，项目、任务和批次能够显示，但代理区域仍可能显示“尚未运行 Composer 或 InfraOptimizer。”

InfraOptimizer 完成后，Host 记录包含完成状态及优化摘要；页面仍从不含代理列表的项目对象读取，因而继续显示空列表提示。正常情况下，控制台应当显示代理运行记录，完成后显示对应状态和摘要。

## 触发条件与影响范围

源码所示条件是快照成功返回，顶层 `agents` 包含记录，而 `project` 对象保持后端当前定义的字段。该场景不要求多个代理同时运行；单次正常的 Composer 或 InfraOptimizer 运行也满足条件。

影响仅是页面无法展示实际存在的代理记录及摘要，用户可能误以为相关代理从未启动。该问题不能证明代理没有真实运行、计算中止或后端数据丢失。真实页面已复现研究代理记录缺失；Composer 和 InfraOptimizer 的角色覆盖来自自动行为检查，本次实际 DSH 没有启动 Composer 或 InfraOptimizer。

## 最新源码复核与证据

B 于北京时间 `2026-10-31T17:48:30.948718+08:00` 串行同步上游和派生仓库，主分支仍为 `66885994ceadad83a237a27c1fc7de6419889c14`。B 检查远端议题及拉取请求，没有发现专门修复该字段传递问题的现有条目。这是源码及远端适用性复核，不等同于产品测试。

- [项目对象字段](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L686)包含编号、目录、模板和评估命令，没有 `agents`。
- [快照代理列表](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L723)位于顶层，与 `project` 同级。
- [客户端取出项目对象](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/client.js#L709)读取 `snapshot.project`。
- [代理区域调用](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/client.js#L799)执行 `agentSection(t, project)`，没有把顶层代理列表传入。
- [代理列表读取](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/client.js#L660)从入参的 `.agents` 读取数组，缺失时使用空数组；[表格渲染](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/client.js#L675)因此选择空列表提示。

## 与现有议题的区别

- [ALEPH-12](12-console-no-campaign-empty-state.md)／上游 [#1](https://github.com/hapenia/aleph-research/issues/1) 及拉取请求 [#2](https://github.com/hapenia/aleph-research/pull/2) 关注没有项目时的 HTTP 404 和空状态。本议题发生于已有项目、接口成功返回且代理列表非空时。B 已检查拉取请求 #2 的实际客户端修改，确认该修改没有调整代理区域参数。
- [ALEPH-14](14-researcher-callback-ownership.md)／上游 [#16](https://github.com/hapenia/aleph-research/issues/16) 及拉取请求 [#18](https://github.com/hapenia/aleph-research/pull/18) 关注后端回调中的代理记录归属。本议题即使后端记录完全正确也可能出现，不要求代理运行重叠。
- [ALEPH-10](10-mission-reports.md) 关注实验报告查询和评测反馈。本议题只要求正确展示快照中已经存在的代理记录，不新增报告接口或通知要求。

## 期望行为与验收条件

1. 快照含运行中的 Composer 或 InfraOptimizer 时，控制台显示对应记录、状态及子会话编号。
2. 代理结束后，控制台通过后续轮询更新状态，并显示对应摘要；页面刷新后仍能展示记录。
3. 快照中的代理列表确实为空时，控制台才显示空列表提示。
4. 不同角色和独立代理记录能够分别显示，项目、任务、批次和机器区域保持正确。
5. B 构建至少 30 个有意义的自动行为测试点，保存命令、版本、替代范围及实际结果，再在真实 DSH 中通过浏览器核查接口响应与页面显示。应分别记录真实页面、模拟快照和请求拦截的范围。
6. 仅检查接口 JSON 或调用后端工具，不能作为页面正确显示的验证证据。

## 验证记录

2026 年 10 月 31 日，A 根据用户明确接纳的决定登记源码线索。A 没有运行产品测试、浏览器或实际 DSH，也没有修改产品代码或操作远端。后续测试、实测、上传和提交由 B 负责。


## 最新上游正式核查

B 在北京时间 2026 年 10 月 31 日完成最新实现核查。正式运行和发布前的远端同步均确认主分支为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`，主工作区没有产品改动。上游此前独立修复了无项目空状态和后端研究代理摘要归属，当前代理表格传参仍未修复。

当前源码为 [代理区域调用](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/client.js#L911)、[代理列表读取](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/client.js#L709)和[顶层代理列表](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/index-v2.js#L1515)。

### 自动行为检查

```bash
ALEPH_CONSOLE_AGENT_OBSERVATIONS=tests/issues/evidence/16-console-agent-baseline.json node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs --test tests/issues/dsh/console-agent-records-acceptance.test.mjs
```

[独立脚本](dsh/console-agent-records-acceptance.test.mjs)调用实际后端快照序列化函数，并在虚拟机中执行完整的客户端 `consoleBody` 和 `agentSection`。测试以结构收集器替代 React 的 `createElement`，项目和代理状态由明确的样例提供；这部分不属于浏览器或实际 DSH 验证。

41 个有效检查点中，17 个通过、24 个失败。Node 汇总额外计算父测试容器，因此显示 42 项、17 项通过、25 项失败。缺失代理编号、角色、分支、状态和摘要的行为断言失败；空列表、项目和机器区域、表格直接接收正确数据等对照通过。角色范围覆盖研究代理、Composer 和 InfraOptimizer。原始输出见[文本报告](evidence/16-console-agent-baseline.txt)及[快照记录](evidence/16-console-agent-baseline.json)。旧基线与早期断言调整记录另行保留，没有计入当前结果。

### 实际 DSH 与浏览器

```bash
python3 tests/issues/dsh/current-console-agents.py --source /home/paulus-chang/项目/aleph --output tests/issues/evidence/16-current-real-dsh-console-agents.json
```

[启动脚本](dsh/current-console-agents.py)在独立配置中运行现有 DSH，加载当前产品代码；[浏览器脚本](dsh/console-agents-browser.mjs)使用 Playwright 与本机 Chrome。环境没有 Browser 插件，因此采用该替代路径，原始记录明确保存 `Browser plugin not available`。

模型响应和等待时机由本地确定性适配器提供；实际父会话、研究子会话、注册工具、持久化存储、Git 工作树、Bash 执行以及页面轮询均使用真实 DSH。测试没有调用外部模型。真实研究代理在独立工作树执行 Bash 写入目录标记，随后等待释放，再返回包含子会话编号的独立摘要。

实际流程为：打开控制台、检查无项目空状态、创建项目、检查真实空列表、启动研究代理、观察运行记录、释放代理、观察完成摘要、刷新页面并重新打开控制台。桌面尺寸为 `1440×1000`，手机尺寸为 `390×844`。23 项观察全部符合复现条件：接口包含正确的运行记录与完成摘要，页面经过定时轮询仍为空；刷新后重新打开也未恢复记录。后端持久化摘要保持正确。

页面标题和项目内容正确，没有框架错误遮罩或未捕获脚本异常。浏览器只记录无项目对照步骤的 `/api/aleph/snapshot` HTTP 404；该请求对应正常的 `aleph/no-project` 空状态，不属于此次代理列表缺陷。正式结束后，隔离 Host 已退出，进程编号不存在。

- [完整实际观察](evidence/16-current-real-dsh-console-agents.json)
- [真实空列表对照](evidence/16-current-project-empty-desktop.png)
- [运行期间桌面页面](evidence/16-current-running-desktop.png)
- [运行期间手机页面](evidence/16-current-running-mobile.png)
- [完成后的桌面页面](evidence/16-current-done-desktop.png)
- [完成后的手机页面](evidence/16-current-done-mobile.png)
- [刷新后重新打开页面](evidence/16-current-reloaded-desktop.png)

首次导航因预览版说明弹窗出现较晚而中断；后续脚本改为等待并关闭弹窗。一次刷新检查因未重新打开 Aleph 而中断，另一次检查因没有区分预期的无项目 404 而中断。这些属于测试脚本调整，原始记录分别保留在 `16-current-real-dsh-navigation-attempt.json`、`16-current-real-dsh-reopen-attempt.json` 和 `16-current-real-dsh-console-log-attempt.json`，没有作为产品失败或增加有效检查点。最终脚本完整通过。


## 远端发布

B 已将该问题上传至上游 [#22](https://github.com/hapenia/aleph-research/issues/22)。公开证据固定于提交 `6cc3510d7b3dea239a9fda6628c6b2158beff9f6`，远端正文移除了 YAML 管理头和前导管理注释，本地仍保留完整原文。发布时议题处于开放状态，产品修复尚未提交。


## 修复验收

C 在基线 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 提供冻结修改，B 在独立工作树 `/home/paulus-chang/项目/aleph-fix-console-agents` 仅导入客户端与新增产品测试。客户端把完整快照传入代理区域，代理表格读取顶层 `snapshot.agents`。导入文件的校验值见[验收清单](evidence/16-console-agents-fixed-manifest.json)。

B 于北京时间 `2026-10-31T19:23:34+08:00` 再次串行获取上游和派生仓库，主分支仍为该基线，主工作区干净。B 独立执行产品测试，新增测试包含 54 个有效行为点，Node 连同容器和既有测试报告 64 项通过、0 项失败；B 的独立行为脚本包含 41 个有效检查点，全部通过，Node 连同容器报告 42 项通过、0 项失败。

```bash
cd /home/paulus-chang/项目/aleph-fix-console-agents/dsh-plugin
npm test
cd /home/paulus-chang/项目/aleph-tests
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph-fix-console-agents ALEPH_CONSOLE_AGENT_OBSERVATIONS=tests/issues/evidence/16-console-agents-fixed-independent.json node --experimental-loader /home/paulus-chang/项目/aleph-fix-console-agents/dsh-plugin/test/loader.mjs --test tests/issues/dsh/console-agent-records-acceptance.test.mjs
python3 tests/issues/dsh/current-console-agents.py --source /home/paulus-chang/项目/aleph-fix-console-agents --expect-protection --screenshot-prefix 16-fixed --output tests/issues/evidence/16-fixed-real-dsh-console-agents.json
```

真实 DSH 浏览器核查的 23 项观察全部通过。页面显示运行中的真实研究子会话；完成后，页面轮询展示相应摘要；刷新页面并重新打开 Aleph 后，持久化记录和摘要仍然显示。空列表对照继续显示空提示。桌面视口为 `1440×1000`，手机视口为 `390×844`。浏览器没有框架错误遮罩或未捕获异常，仅存在已解释的无项目快照 HTTP 404。隔离 Host 的进程编号为 `295680`，核查结束后已退出，进程编号不存在。

真实研究会话、注册工具、持久化存储、Git 工作树、Bash 和页面轮询均由实际 DSH 执行，模型响应采用本地确定性适配器；Composer 和 InfraOptimizer 的角色覆盖仍来自自动样例。手机页面沿用现有宽表布局，部分列超出初始视口；本次核查只确认代理记录与摘要的数据展示恢复，不表示完成响应式布局改造。研究角色仍显示既有的 `role.researcher` 文案。

- [产品测试原始输出](evidence/16-console-agents-fixed-product.txt)
- [独立测试原始输出](evidence/16-console-agents-fixed-independent.txt)与[结构观察](evidence/16-console-agents-fixed-independent.json)
- [实际 DSH 完整记录](evidence/16-fixed-real-dsh-console-agents.json)与[执行输出](evidence/16-fixed-real-dsh-console-agents.txt)
- [修复后运行页面](evidence/16-fixed-running-desktop.png)、[完成页面](evidence/16-fixed-done-desktop.png)及[刷新页面](evidence/16-fixed-reloaded-desktop.png)
- [修复后手机运行页面](evidence/16-fixed-running-mobile.png)与[手机完成页面](evidence/16-fixed-done-mobile.png)

新工作树首次运行缺少依赖链接，B 配置已有依赖后完成正式验收；该环境错误保存在 `16-console-agents-fixed-product-dependency-attempt.txt`，没有计为产品失败。原始缺陷证据及截图保持保留。
