---
id: ALEPH-04
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/5
pull_request: null
---

# 并发任务可能把最优分支覆盖为较差结果

## 最新架构正式复核（2026-10-31）

当前上游基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。B 在发布前依次获取上游和派生仓库，并对干净主分支执行仅快进同步；上游版本没有变化。后文旧架构证据仅作为历史记录，本次结论以当前 project、mission 和 batch 实现为准。

[综合独立自动检查](dsh/current-evaluation-history.test.mjs)包含 172 个有效行为点，全部通过；Node 包含父容器为 173 项。[自动结构化结果](evidence/04-10-current-evaluation-history.json)和[原始输出](evidence/04-10-current-evaluation-history.txt)保留完整结果。[实际 DSH 启动脚本](dsh/current-evaluation-history.py)使用真实会话、注册工具、持久存储、认证接口、Git 和 Python 评分，[实际结构化结果](evidence/04-10-current-real-dsh-evaluation-history.json)与[原始输出](evidence/04-10-current-real-dsh-evaluation-history.txt)中的 172 个有效行为点全部通过。隔离 Host `427736` 已正常退出，记录确认进程不存在。该轮次没有调用模型、修改产品源码或缩短产品期限。

[逐项归属表](evidence/04-10-current-mapping.json)将每个断言只归属一个议题：原 #5 的当前最优结果一致性占 21 点，原 #11 的报告与历史查询占 151 点。综合自动检查满足至少 30 个测试点的要求，单项归属没有重复计数。

当前最优结果采用项目的 `best` 记录与独立评估报告引用，不再使用旧 `sota/main` 晋升路径。受控并发评估分别覆盖较高分先完成、较低分先完成及同分先后完成。较高分先完成和较低分先完成的顺序均保留最高分、实际评估源码、报告提交和报告引用的一致关系；同分保留先完成的记录。没有分数的报告不会成为最优结果，评估失败不会污染历史或最优记录。

当前检查没有复现旧版晋升竞态，但结论仅限同一 Host 的当前评估更新路径。该轮次没有验证多台机器同时更新、外部进程写引用或旧架构分支晋升，不能据此宣布多机器领域已经完成。原远端议题和本地管理状态保持原值。


## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版依赖 `sota/main` 晋升流程；当前执行路径改为批次运行和任务结果提交，未沿用该晋升流程。旧竞态证据只证明旧版行为。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

并发任务更新最优分数与 `sota/main` 分支的顺序可能不一致。较低分任务延迟写入分支时，会覆盖较高分任务的提交，导致分数记录与实际代码不符。

## 复现

1. 并发启动评分任务，分别产生 10 分和 20 分的结果。
2. 让低分任务先更新状态，暂缓其对 `sota/main` 的 Git 写入。
3. 等待高分任务完成状态与分支更新，再释放低分任务的写入。
4. 对比最高分记录与 `sota/main` 的代码。

## 实际结果

保存的 `sota_score` 为 `20`，但 `git show sota/main:score.txt` 返回 `10`。后续研究可能继承较差代码。

## 预期结果

最优分数与分支始终对应同一个结果；延迟的旧写入不能覆盖新的最优提交。分支更新失败时应明确报告错误。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认。测试通过 [Git 包装脚本](dsh/git) 控制写入顺序，使用真实研究子代理与系统 Git，未修改插件源码；该结果不代表自然发生概率。证据见 [实测记录](evidence/04-real-dsh-sota-race.json) 和 [写入顺序](evidence/04-real-dsh-git-order.log)，版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。
