---
id: ALEPH-08
status: dsh实测有问题
type: 功能缺项
remote_issue: https://github.com/hapenia/aleph-research/issues/9
pull_request: null
---

# 任务完成后未自动继续剩余研究任务

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版依赖 campaign 队列、`aleph_run_available` 和研究任务完成回调。当前流程改为提案、审批、批次编排与执行，自动推进的预期行为需要重新确认。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

任务完成并释放容量后，系统没有自动推进剩余队列。研究需要再次调用派发工具才能继续，缺少持续执行流程。

## 复现

1. 设置并发上限为 `1`，不限制预算，排队两个任务。
2. 调用一次 `aleph_run_available`。
3. 等待首个任务完成评测和清理，不再发送消息或调用派发工具。
4. 等待约 90 秒，再查询状态。

## 实际结果

状态仍为 `active_agents: 0`、`queued: 1`、`done: 1`，剩余任务没有自动启动。自动测试中显式再次派发能够完成第二个任务。

## 预期结果

容量释放后自动继续队列，并将结果反馈给 Leader 以决定后续研究。执行过程遵守预算、目标和人工停止条件，同一任务不会重复派发。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，观察范围为首个任务完成后约 90 秒。证据见 [持续执行记录](evidence/08-real-dsh-continuation.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。报告内容由 [ALEPH-10](10-mission-reports.md) 处理，人工控制由 [ALEPH-09](09-campaign-controls.md) 处理。
