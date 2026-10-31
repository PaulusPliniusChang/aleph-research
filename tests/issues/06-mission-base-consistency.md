---
id: ALEPH-06
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/7
pull_request: null
---

# 任务记录的代码起点可能与实际起点不一致

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版依赖排队任务的 `baseBranch` 与 SOTA 起点；当前任务改为独立 mission 分支和 `preBatchTip`。当前分支起点一致性需要独立验证。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

任务排队后，如果最优分支发生变化，派发时可能仍从旧起点创建工作目录，却把任务起点记录为最新最优分支，影响实验比较和结果追溯。

## 复现

1. 最优分支还是 `initialize` 时，排队两个任务。
2. 启动并完成首个任务，使最优分支变为 `sota/main`。
3. 派发原排队任务，对比 `baseBranch`、`baseCommit` 与实际提交的父提交。

## 实际结果

任务记录的 `baseBranch` 为 `sota/main`，但 `baseCommit` 和实际父提交仍是初始化提交，没有继承首个实验的代码。

## 预期结果

任务实际使用的起点、记录的分支与基线提交保持一致。排队或派发时确定起点均可，但必须一致执行并准确记录。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认。原始任务记录与真实 Git 提交关系见 [起点实测记录](evidence/06-real-dsh-base-consistency.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。
