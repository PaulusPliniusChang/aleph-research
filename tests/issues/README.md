# 本地议题索引

议题维护遵循 [管理规则](RULES.md)。每条议题的当前状态以文件开头的 `status` 字段为准。

本轮测试、实际 DSH 观察与被测版本说明见 [2026 年 10 月 31 日验证记录](VALIDATION-2026-10-31.md)。

最新主仓库已经采用 project、mission 和 batch 模型。旧议题的适用范围、上游链接与尚需复测的内容见[当前架构与历史议题复核](ARCHITECTURE-REVIEW-2026-10-31.md)。历史状态不代表最新版本已经复现。

| 编号 | 议题 |
| --- | --- |
| ALEPH-01 | [单任务派发可以绕过并发上限](01-run-next-concurrency.md) |
| ALEPH-02 | [预算没有完整限制任务创建和启动](02-run-next-budget.md) |
| ALEPH-04 | [并发任务可能把最优分支覆盖为较差结果](04-sota-promotion-race.md) |
| ALEPH-05 | [DSH 重启后未完成任务缺少后续处理](05-restart-recovery.md) |
| ALEPH-06 | [任务记录的代码起点可能与实际起点不一致](06-mission-base-consistency.md) |
| ALEPH-07 | [研究策略没有传给研究代理，也缺少不同策略的任务要求](07-research-strategy-instructions.md) |
| ALEPH-08 | [任务完成后未自动继续剩余研究任务](08-continuous-research.md) |
| ALEPH-09 | [研究过程缺少暂停、恢复、取消和结束操作](09-campaign-controls.md) |
| ALEPH-10 | [实验结果缺少可查询的报告和给 Leader 的评测反馈](10-mission-reports.md) |
| ALEPH-11 | [最优结果缺少人工选择和回退操作](11-sota-selection-rollback.md) |
| ALEPH-12 | [无战役时控制台显示快照读取失败，未展示空状态引导](12-console-no-campaign-empty-state.md) |
| ALEPH-13 | [同一批次重复启动 InfraOptimizer 会删除正在使用的工作目录](13-infra-duplicate-start.md) |

原议题 `ALEPH-03`，文件 `03-composer-running-budget.md`，已经并入 [ALEPH-02](02-run-next-budget.md)。原有运行任务预算占用问题、复现步骤和自动测试均已保留，编号 `ALEPH-03` 不再复用。
