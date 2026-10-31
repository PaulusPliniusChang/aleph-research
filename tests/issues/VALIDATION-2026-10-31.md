# 2026 年 10 月 31 日议题验证记录

## 当前 project、mission、batch 架构的补充验证

当前主仓库为 `66885994ceadad83a237a27c1fc7de6419889c14`。ALEPH-05 已在当前架构完成缺陷复现与修复验收，前置修复为 [PR #13](https://github.com/hapenia/aleph-research/pull/13)。新接纳的 ALEPH-13 已完成自动测试和实际 DSH 双阶段复现，并发布为 [#14](https://github.com/hapenia/aleph-research/issues/14)。最终组合修复为提交 `be646b3` 与 [PR #15](https://github.com/hapenia/aleph-research/pull/15)，该请求依赖 #13。

组合版本由 B 串行独立验收：产品 168 项、优化 65 个行为点、恢复 67 个行为点全部通过；实际 DSH 的活动优化跨恢复扫描 63 项、直接运行与优化互斥 45 项、实际计算期间重复调用 55 项、计算完成后重启 50 项和活跃孤立计算重启 57 项均通过。原始报告、执行命令、文件摘要与替代范围见 [ALEPH-13](13-infra-duplicate-start.md)；前置单独验收见 [ALEPH-05](05-restart-recovery.md)。

ALEPH-06 已在当前主仓库完成适用性核查：76 个自动行为测试点全部通过，Node 连同父测试容器报告 77/77；实际 DSH 的 61 项检查全部通过。测试涵盖独立 mission 分支在提案后或审批后推进、组合批次、实际运行源码、`preBatchTip`、公共记录和结果提交父节点。当前已测范围没有复现旧版问题，上游 #7 保持开放，历史状态和证据保留。脚本、记录及边界见 [ALEPH-06](06-mission-base-consistency.md)。

ALEPH-01 已在同一主仓库版本完成当前容量缺陷复现：54 个自动行为点中 49 个通过、5 个失败；Node 包含父测试容器，报告 55 个测试、6 个失败。实际 DSH 的 63 项观测检查全部通过，确认并发编排为同一台机器形成不同批次并同时计算。真实 Git 没有命令错误，调度控制只延迟后续请求的初次模板提交读取；该结果表示缺陷复现。首次调度编号错误的记录独立保留，不计入产品证据。脚本、版本、控制范围与实际记录见 [ALEPH-01](01-run-next-concurrency.md)。

下述原始验证属于旧 campaign 架构的历史记录，不作为其余旧议题已经适用于当前版本的依据。当前适用性逐项记录于[架构复核](ARCHITECTURE-REVIEW-2026-10-31.md)。历史段落中的“本轮”和“尚未提交”描述保留原始执行时点，不覆盖上述提交与发布记录。

## 旧版历史验证

## 结果与版本

本轮由自动测试代理与实际 DSH 复现代理分别完成验证。ALEPH-01、ALEPH-04 至 ALEPH-11 均已获得实际 DSH 证据。ALEPH-02 沿用已有实际 DSH 记录，ALEPH-12 保留用户维护的“已上传”状态。本轮没有排除议题；当前“可疑”和“自动测试证实问题”状态下均无剩余议题。

各议题的唯一当前状态仍保存在各自文件开头的 `status` 字段中。本文件仅记录本轮验证结果。

被测工作区为 `aleph-tests`，基础提交为 `a77893e13cdba998311278a0493e9ac60ffc3351`，新增测试与证据尚未提交。被测 Host 对应产品提交 `bd94c8c09f553c0bb92965704db9bf5c834cf749` 的 `dsh-plugin/index.js`，源码 SHA256 为 `077b676de0142458a1783b6581ef0f4af9657af8fdf9e48a09a1af0b34a8752a`。实际 DSH 加载的隔离插件副本与该文件校验值相同。

主工作区在验证期间已由其他工作更新至 `ecfef494cde8dc5f449491405cc9135e383760a9`，插件版本为 `0.3.0`，入口改为 `index-v2.js`。本轮结论仅适用于上述固定的被测 Host，不表示已经在新版入口复现相同问题。

## 自动测试

在 `aleph-tests` 根目录执行：

```bash
node --test tests/host.test.mjs tests/suspect-issues.test.mjs
ALEPH_STRICT_REGRESSIONS=1 node --test tests/host.test.mjs tests/suspect-issues.test.mjs
```

普通模式共执行 27 项测试，其中 16 项通过，11 项对应已知问题的断言实际失败并标记为 `TODO`，进程退出码为零。严格模式移除该标记后，16 项通过、11 项失败，失败均来自对应行为断言。严格模式的失败是问题复现结果，不代表产品通过验收。

完整记录分别保存在 [普通模式输出](evidence/combined-default-tests.txt) 和 [严格模式输出](evidence/combined-strict-tests.txt)。新增用例位于本地工作区的 `tests/suspect-issues.test.mjs`。该文件与相关测试辅助文件仍包含用户既有未提交改动，不纳入本轮文档维护提交；仅检出该文档提交时，不能直接复跑这些新增用例。ALEPH-08 同时包含显式再次派发能够成功的对照用例，以及不再次派发时队列无法自动推进的失败用例。

## 实际 DSH 观察

环境为安装版 DSH `0.2.2-alpha.2`，使用独立状态目录、真实会话、研究子代理、模型服务、Git 与评测进程。复现脚本和操作说明见 [DSH 复现目录](dsh/README.md)。

| 议题 | 实际观察 | 证据 |
| --- | --- | --- |
| ALEPH-01 | 并发上限为 1 时，连续单任务派发使运行任务数达到 2。 | [并发记录](evidence/01-real-dsh-concurrency.json) |
| ALEPH-04 | 保存的最高分为 20，真实最优分支仍包含 10 分代码。 | [竞态记录](evidence/04-real-dsh-sota-race.json)、[Git 时序](evidence/04-real-dsh-git-order.log) |
| ALEPH-05 | 异常退出并重启后，任务仍显示运行中，对应子代理已不存在，工作目录未处理。 | [重启记录](evidence/05-real-dsh-restart.json) |
| ALEPH-06 | 保存的起点名称为 `sota/main`，实际基线与提交父节点仍为初始化提交。 | [基线记录](evidence/06-real-dsh-base-consistency.json) |
| ALEPH-07 | 真实研究子代理的初始上下文没有所选策略与对应研究要求。 | [会话上下文](evidence/07-real-dsh-researcher-context.json) |
| ALEPH-08 | 首任务完成约 90 秒后，容量空闲，剩余任务仍未自动启动。 | [持续执行记录](evidence/08-real-dsh-continuation.json) |
| ALEPH-09 | 实际 Aleph 工具目录没有研究活动暂停、恢复、取消或结束操作。 | [工具声明](evidence/09-11-real-dsh-tools.json) |
| ALEPH-10 | 交接报告进入真实 Git 提交，但查询缺少报告正文与评测额外结果，父会话未收到评测反馈。 | [报告记录](evidence/10-real-dsh-reports.json) |
| ALEPH-11 | 实际活动已有历史结果，但正式工具没有选择历史结果或回退操作。 | [工具声明](evidence/09-11-real-dsh-tools.json) |

ALEPH-04 通过包装系统 Git 控制分支写入时机，未替换 Git 结果。该记录证明竞态可以触发，不能据此推算自然发生概率。ALEPH-09、ALEPH-11 的结论限于运行中 DSH 注册的 Aleph 正式操作。

ALEPH-05 在任务创建约 6 分钟后再次查询，仍未恢复；该时长超过任务要求的 120 秒等待。运行中代理查询同时确认原子代理不在内存中。实测覆盖进程异常退出，不涵盖所有正常关闭方式。

## 保存与维护

本轮测试、脚本、证据及议题维护均保存在 `aleph-tests`。议题索引、状态字段、证据引用和本地链接已经检查；没有通过修改状态规避重复议题规则。ALEPH-02 的预算限制与 ALEPH-01 的并发限制分别约束不同条件；ALEPH-04 的自动晋级一致性与 ALEPH-11 的人工选择操作也具有不同验收范围。

本轮没有修改主工作区，没有提交代码、推送分支或上传议题。实际 DSH 复现使用的临时数据目录保留供核查，凭据文件不纳入证据或仓库。

## 公开证据

议题文档、复跑脚本与验收记录已经发布到派生仓库的独立证据分支 `evidence/2026-10-31-validation`，固定提交为 `23f4c0f67f78c39639c9d3a877b337e3907b7499`，入口见[公开证据目录](https://github.com/PaulusPliniusChang/aleph-research/tree/23f4c0f67f78c39639c9d3a877b337e3907b7499/tests/issues)。该分支以当前 `main` 为基础，仅加入已经提交的 `tests/issues` 文件，没有加入旧测试分支的产品实现或用户未提交测试改动。本地管理字段和注释保持，GitHub 议题正文不包含管理头和前导注释。
