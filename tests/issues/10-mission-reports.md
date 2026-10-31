---
id: ALEPH-10
status: dsh实测有问题
type: 功能缺项
remote_issue: https://github.com/hapenia/aleph-research/issues/11
pull_request: https://github.com/hapenia/aleph-research/pull/28
---

# 实验结果缺少可查询的报告和给 Leader 的评测反馈

## 自动完成反馈修复与正式验收（2026-10-31）

修复已发布为 [PR #28](https://github.com/hapenia/aleph-research/pull/28)，当前开放且没有合并。本地管理状态保持原值，原议题保持关闭；公开修复链接与验收结果不代表上游已经发布。

修复提交为 `b82a72217cc74c8a1dbbc8849c248ea241047082`，派生仓库分支为 `fix/aleph-10-parent-feedback`。修复以 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 为基线，将研究代理的结束投递选项改为 `parent`。DSH 原生管理器负责把最终文字送到创建该研究代理的准确 Leader；Host 没有额外发送重复通知。研究提示要求最终摘要引用实际评估返回的状态、分数、报告提交、源码提交和独立引用，评估未完成时如实说明。Composer 和 InfraOptimizer 的投递方式保持原值。

产品自动测试为 **50／50 通过**，其中新增有效行为点为 37 项，另有 6 个父容器及 7 项既有测试，见[产品原始输出](evidence/10-fixed-parent-feedback-product.txt)。B 的[独立自动验收](dsh/current-parent-delivery-acceptance.test.mjs)执行注册工具、真实 Git 研究工作树和状态回调，使用内存存储及受控 activation 后端，包含 **58 个有效行为点，全部通过**；Node 包含父容器为 59 项，见[结构化结果](evidence/10-fixed-parent-delivery.json)及[原始输出](evidence/10-fixed-parent-delivery.txt)。

[实际 DSH 验收](dsh/fixed-parent-feedback.test.mjs)通过[隔离启动脚本](dsh/fixed-parent-feedback.py)运行，包含 **51 个有效观察点，全部通过**；Node 包含父容器为 52 项，见[实际记录](evidence/10-fixed-real-dsh-parent-feedback.json)及[原始输出](evidence/10-fixed-real-dsh-parent-feedback.txt)。真实研究代理亲自调用已注册的评估工具，Python 得到 37 分，Git 创建报告及独立引用；模型随后输出由实际结果组成的结束摘要，没有调用显式发送工具。准确 Leader 自动收到原生通知，内容包括真实分数、报告、引用及源码提交。Host 的准确代理记录随后完成并保存摘要。

同项目另一名真实研究代理在首个代理完成后仍然运行，摘要为空；该代理随后独立结束，保存独立摘要，并产生独立原生通知。父会话正在处理首条通知时，后续代理的通知进入真实收件队列。验收按消息编号识别同一通知在收件事件与会话正文中的记录，没有把相同消息重复计数，也没有声称父会话已经完成后续处理。隔离 Host `471949` 正常退出，进程不存在。来源、冻结文件摘要及替代范围见[验收来源记录](evidence/10-fixed-parent-feedback-source-manifest.json)。

当前保证范围是仍可用的原父会话收到 DSH 原生自动结束通知。原生通知早于 Host 保存完成状态，查询可能短暂仍显示运行中；验收等待最终状态。父会话退出、父对象被替换或原生投递失败时，没有新增补投或持久消息保证。提示不能保证任意模型完整引用评估字段，Host 也没有自动拼接结构化报告。持久摘要沿用 8000 字符上限，原生通知使用实际结束文字，本次不承诺任意长度完整投递。

首次独立夹具因计数变量遮蔽而中断，[原始记录](evidence/10-fixed-parent-delivery-counter-fixture-attempt.txt)单独保留。首次实际夹具把同一通知的收件插入与正文展示重复计数，[结构化记录](evidence/10-fixed-real-dsh-notice-count-fixture-attempt.json)及[输出](evidence/10-fixed-real-dsh-notice-count-fixture-attempt.txt)单独保留。第二次实际夹具只查询已进入正文的通知，遗漏正在等待父会话处理的收件通知，相关[记录](evidence/10-fixed-real-dsh-inbox-fixture-attempt.json)及[输出](evidence/10-fixed-real-dsh-inbox-fixture-attempt.txt)单独保留。最终夹具按真实消息编号和发送代理编号检查收件与正文，完整通过；上述夹具错误均不计为产品失败。

## 最新架构正式复核（2026-10-31）

当前上游基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。B 在发布前依次获取上游和派生仓库，并对干净主分支执行仅快进同步；上游版本没有变化。后文旧架构证据仅作为历史记录，本次结论以当前 project、mission 和 batch 实现为准。

[综合独立自动检查](dsh/current-evaluation-history.test.mjs)包含 172 个有效行为点，全部通过；Node 包含父容器为 173 项。[自动结构化结果](evidence/04-10-current-evaluation-history.json)和[原始输出](evidence/04-10-current-evaluation-history.txt)保留完整结果。[实际 DSH 启动脚本](dsh/current-evaluation-history.py)使用真实会话、注册工具、持久存储、认证接口、Git 和 Python 评分，[实际结构化结果](evidence/04-10-current-real-dsh-evaluation-history.json)与[原始输出](evidence/04-10-current-real-dsh-evaluation-history.txt)中的 172 个有效行为点全部通过。隔离 Host `427736` 已正常退出，记录确认进程不存在。该轮次没有调用模型、修改产品源码或缩短产品期限。

[逐项归属表](evidence/04-10-current-mapping.json)将每个断言只归属一个议题：原 #5 的当前最优结果一致性占 21 点，原 #11 的报告与历史查询占 151 点。综合自动检查满足至少 30 个测试点的要求，单项归属没有重复计数。

报告查询部分已经形成可复核路径：每次成功评估保存历史条目、被评估提交、研究分支、报告提交及独立报告引用。真实 Git 报告保留 `rows`、`diagnostic` 和相对基线变化；工具返回标准输出和标准错误。无分数报告仍记入历史，失败保留诊断且不会形成成功历史。当前工具标准输出保留前 8000 个字符，提交报告保留前 4000 个字符；本次记录此限制，没有声称任意长度报告完整保存。当前查询信息可以定位 Git 报告，不能等同于父会话已经收到报告。

### 研究代理完成后的实际父会话反馈

[实际专项脚本](dsh/current-parent-feedback.test.mjs)通过[隔离启动脚本](dsh/current-parent-feedback.py)启动真实研究代理。确定性模型亲自调用已注册的 `aleph_evaluate`，真实 Python 读取研究代码并返回 37 分；Host 创建真实报告提交、历史条目和独立报告引用。模型随后输出包含实际分数、报告提交、报告引用及源码提交的完整结束摘要。[实际记录](evidence/10-current-real-dsh-parent-feedback.json)和[原始输出](evidence/10-current-real-dsh-parent-feedback.txt)包含额外 39 个有效观察点，全部符合缺陷与对照预期；Node 包含父容器为 40 项。观察通过表示下述残留成功复现。

研究代理完成后，项目中的准确代理记录变为 `done`，完整摘要正确保存，研究代理已经退出，研究工作树仍然存在。但是 Leader 仍然存活，父会话完成前后的真实 `session.log` 均只有原来的 4 条事件，内容相同，没有收到分数、报告提交、报告引用或完成通知。当前 `startResearcher` 使用 `delivery: 'caller'`，完成回调只更新项目代理记录；实际安装的 DSH 服务在该选项下跳过自动完成通知，与实际观察一致。

结论仅指自动完成回传不能保证送达。DSH 的通用子代理提示另有显式 `send_message` 要求，该确定性模型没有调用显式发送工具；本次没有证明显式发送失败，也没有证明所有实际模型都会遗漏发送。实际 Aleph 提示中的评估后结束要求、分配分支和工作目录，以及准确父子身份均有日志证据。父会话已经退出的处理不在本轮范围。

专项没有修改产品源码或期限。首次检查因读取代理列表的快照位置错误而中断，[结构错误记录](evidence/10-current-parent-feedback-shape-fixture-attempt.json)及[原始输出](evidence/10-current-parent-feedback-shape-fixture-attempt.txt)单独保留。第二次检查错误读取不存在的 `session.events`，相关[日志读取错误记录](evidence/10-current-parent-feedback-log-fixture-attempt.json)及[原始输出](evidence/10-current-parent-feedback-log-fixture-attempt.txt)单独保留，不能作为产品缺陷证据。最终夹具改读真实 `session.log`，通过完整检查，隔离 Host 正常退出且进程不存在。准确源码与运行时摘要见[来源记录](evidence/10-current-parent-feedback-source-manifest.json)。

报告查询已通过当前架构复核，自动父反馈仍有上述有限残留。原 #11 沿用现有议题，本地管理状态及远端关闭状态保持原值，不以查询通过推断整项问题已经解决。


## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。当前实现已包含任务结果信封和研究评测报告写入路径，旧版状态快照字段缺失的证据不能直接证明当前报告路径存在相同问题。当前报告内容与交付完整性需要独立测试。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

任务查询只提供状态、分数和分支等摘要，没有完整实验报告。交接报告留在 Git 提交中，评测额外信息没有保存并反馈给 Leader，影响后续研究决策。

## 复现

1. 让研究任务提交交接报告。
2. 让评测命令输出分数以及 `rows`、`diagnostic` 等额外结果。
3. 完成任务后检查 `aleph_status`、快照、存储和父会话反馈。

## 实际结果

Git 提交包含交接报告；查询只有分数等摘要，没有报告正文及额外评测结果，存储未保存额外结果，父会话也未收到评测完成反馈。

## 预期结果

可以按任务查询改动摘要、交接报告、评测信息、失败原因及相对基线的变化。评测完成后将报告反馈给 Leader。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，真实评测输出包含 `score: 30`、`rows: 1000` 与诊断信息。证据见 [报告实测记录](evidence/10-real-dsh-reports.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。自动继续执行由 [ALEPH-08](08-continuous-research.md) 处理。
