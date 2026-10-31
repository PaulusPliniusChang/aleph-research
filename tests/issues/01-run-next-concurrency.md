---
id: ALEPH-01
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/3
pull_request: null
---

# 单任务派发可以绕过并发上限

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `66885994ceadad83a237a27c1fc7de6419889c14`，被测产品没有未提交改动，插件入口为 `dsh-plugin/index-v2.js`。旧版 `aleph_run_next` 已移除；当前容量约束体现为一台机器只能被一个未结束批次占用。本轮通过自动测试和实际 DSH 核查，确认并发 `aleph_form_batch` 请求仍能突破该约束。

### 当前缺陷

并发编排请求能够在首次异步 Git 调用前读取同一台空闲机器与同一组已审批任务。首个请求完成编排并写入机器占用后，另一个请求继续使用先前读取的状态，再创建批次并覆盖机器与任务归属。最终持久记录中，一台机器对应未结束的不同批次；实际运行这些批次时，同一任务会在不同批次工作目录中同时计算。

本轮自动验收包含 54 个行为测试点，其中 49 个通过、5 个失败。Node 额外计入父测试容器，报告 55 个测试、49 个通过和6 个失败。失败断言分别覆盖后续并发请求未拒绝、超额批次、机器归属覆盖、任务归属覆盖，以及同时启动超额计算。实际 DSH `0.2.2-alpha.2` 的 63 项观测检查全部通过，表示当前缺陷已经复现，不表示修复通过验收。顺序请求在机器占用期间能够正确拒绝；正常任务成功或失败后均释放容量，对照场景已通过。

### 当前复现步骤

1. 通过当前注册工具创建项目，准备独立 mission 分支，提案并审批。
2. 发起首个 `aleph_form_batch` 请求，在首个真实 Git 调用已经进入而请求尚未结束时，发起另一个相同请求。
3. 使用透明 Git 调度脚本，只延迟后续请求的初次 `rev-parse template`，直到首个请求编排并持久化机器占用后再放行。实际 Git 命令、产品源码与持久存储均保持真实。
4. 核对两次请求响应、实际批次记录、机器归属、任务归属，以及批次分支包含原任务提交的 Git 祖先关系。
5. 通过实际 `aleph_run_batch` 分别运行已形成的批次，保持首个任务计算未结束，再启动后续批次。检查真实任务启动记录和不同的输出目录，然后释放测试任务并完成清理。

两次并发编排均成功，持久记录包含同一台 `local` 机器上的两个 `forming` 批次，后续请求覆盖机器和任务归属。真实任务同时运行于不同批次工作目录；全部 Git 命令返回零，没有 Git 锁冲突或测试脚本异常。该调度用于稳定复现已经进入公共接口的并发请求，不用于推算自然发生概率。

### 当前验收要求与边界

同一任务仓库的编排必须保护机器检查、任务选择、Git 操作和最终归属写入；竞争请求需要依据最新状态拒绝或等待后重新检查。失败后的清理必须恢复可继续编排的状态，且不能覆盖其他批次的机器或任务归属。本轮仅核对当前机器与批次容量，不要求恢复旧版 `max_parallel` 工具，也不涵盖多个独立宿主共同操作同一目录的契约。

自动测试调用真实 `ProjectService`、Git、runner 和 shell 任务，磁盘 JSON 适配器与模块加载器替代 DSH 存储和工具包依赖。实际 DSH 场景使用真实注册工具与持久存储，不调用模型；隔离服务已经停止。首次自动测试的调度编号曾与请求顺序不一致，该次原始记录独立保存在 `01-capacity-fixture-ordering.*`，不作为产品缺陷证据，也不计入上述有效结果。

### 当前脚本与证据

在 `aleph-tests` 根目录执行：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_CAPACITY_OBSERVATIONS=tests/issues/evidence/01-current-machine-capacity.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/machine-capacity-acceptance.test.mjs

python3 tests/issues/dsh/current-machine-capacity.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/01-current-real-dsh-machine-capacity.json
```

证据包括[自动验收脚本](dsh/machine-capacity-acceptance.test.mjs)、[自动报告](evidence/01-current-machine-capacity.txt)、[自动结构化记录](evidence/01-current-machine-capacity.json)、[实际 DSH 脚本](dsh/current-machine-capacity.py)、[透明 Git 调度脚本](dsh/form-batch-git-scheduler.py)与[实际 DSH 记录](evidence/01-current-real-dsh-machine-capacity.json)。本轮沿用上游 [#3](https://github.com/hapenia/aleph-research/issues/3)，没有重复创建议题。完整架构范围见[适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 旧版历史记录

下述工具、复现与证据针对旧 campaign 架构，保留原始结论供追溯。

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
