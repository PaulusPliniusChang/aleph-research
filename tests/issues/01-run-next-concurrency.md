---
id: ALEPH-01
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/3
pull_request: null
---

# 单任务派发可以绕过并发上限

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版触发入口为 `aleph_run_next`；当前插件未注册该工具。当前批次的机器占用与并发约束需要独立测试，不能直接沿用旧入口的复现结论。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

`aleph_run_next` 没有检查并发上限，已有任务占满容量时仍能启动新任务，造成超额资源使用。

## 复现

1. 设置 `ALEPH_MAX_PARALLEL=1`，创建研究活动并排队两个任务。
2. 调用 `aleph_run_next`，保持首个任务运行。
3. 再次调用 `aleph_run_next`，查询 `aleph_status`。

## 实际结果

第二个研究代理成功启动。状态返回 `max_parallel: 1`、`active_agents: 2`、`counts.running: 2`。

## 预期结果

容量已满时拒绝派发，剩余任务保持排队；任务完成并释放容量后才允许继续派发。并发检查与派发预约应保持一致，避免同时调用时突破上限。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，真实研究子会话已发起模型请求并调用工具。证据见 [并发实测记录](evidence/01-real-dsh-concurrency.json)。被测版本、自动测试命令和复现脚本见 [验证记录](VALIDATION-2026-10-31.md)。
