---
id: ALEPH-02
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/4
pull_request: null
---

# 预算没有完整限制任务创建和启动

## 最新架构正式核查（2026-10-31）

当前主分支为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。本轮预算适用性检查包含 **30 个不同的自动行为检查点和 30 个实际 DSH 检查点，全部通过**；联合研究策略套件共 64 个有效检查点，父测试容器另计。原有管理状态和旧版复现证据保留，不据历史状态认定当前版本仍有旧版缺陷。

当前项目初始化工具没有数值预算参数，项目状态没有 `budget` 或 `spent`，旧版额度设置和 `aleph_run_next` 也未注册。当前流程使用任务审批和机器预留：未批准任务不能编排，批准本身不运行计算；批次预留本地机器，计算执行期间保留准确归属，完成后释放机器并提交可读取的结果。上述检查均通过。审批和机器占用不能表示金额或累计计算额度限制。

上游审查将数值预算要求保留在多机器范围。旧 campaign 数值预算的复现步骤不适用于当前注册工具；当前不以字段移除证明预算功能已经实现，也不恢复旧额度工具。后续迁移说明将记录设计边界，原远端议题保持原有开闭状态。

自动检查替代了存储、会话和激活回执，Git、工作树及计算命令实际执行。实际检查使用 DSH `0.2.2-alpha.2`、持久状态、注册工具、原生研究子会话和真实 shell 计算；本地确定性模型仅控制回复与等待。批次工具由检查脚本明确调用，本轮不据此声称 Composer 已自主编排后续任务。实际 Host `534895` 已退出，进程编号不存在。

检查入口：[当前契约自动检查](dsh/current-budget-strategy.test.mjs)、[实际 DSH 启动器](dsh/current-budget-strategy.py)、[初始上下文记录适配器](dsh/migration-context-bridge.mjs)。原始结果：[自动报告](evidence/02-07-current-automatic.json)、[自动日志](evidence/02-07-current-automatic.txt)、[实际报告](evidence/02-07-current-real-dsh.json)、[实际日志](evidence/02-07-current-real-dsh.txt)。首次断言误用旧任务状态 `running`，当前任务在批次运行时保持 `batched`；[首次报告](evidence/02-07-current-state-fixture-attempt.json)和[日志](evidence/02-07-current-state-fixture-attempt.txt)单独保留，属于检查脚本预期错误。

复跑命令：

```bash
ALEPH_CURRENT_SOURCE=/path/to/current-source ALEPH_MIGRATION_OUTPUT=/tmp/current-contract.json node --test tests/issues/dsh/current-budget-strategy.test.mjs
python3 tests/issues/dsh/current-budget-strategy.py --source /path/to/current-source --output /tmp/current-contract-real.json
```

自动检查需要被测副本能够解析实际 DSH 的已安装依赖；本轮使用独立源码副本并引用运行时依赖，主工作区未增加依赖文件。

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版依赖 campaign 预算与派发工具；当前项目模型没有相同预算字段，也没有旧版创建、编排和派发工具。旧议题的预算验收条件需要重新确认适用范围。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

预算没有完整限制任务创建和启动：预算为零时仍能派发排队任务；创建批次时漏算运行中任务占用的额度，导致预算被重复使用。

## 复现

- 启动限制：创建活动并加入排队任务，将 `budget` 设为 `0`，调用 `aleph_run_next`。
- 创建限制：将 `budget` 设为 `1`，通过 `aleph_compose_batch` 创建并启动一个任务；保持任务运行，再请求创建一个任务。

## 实际结果

预算为零时仍创建研究子会话和工作目录。预算为一且已有任务运行时，Composer 仍接受新批次，新增排队任务。

## 预期结果

任务创建和派发均检查预算，运行中任务持续占用额度；降低预算后，已有排队任务也受新预算约束。预算不足时不启动研究代理或创建工作目录。

## 验证

已有 DSH 隔离配置 `aleph-regression-validation` 的实测记录确认预算为零和运行中额度占用场景，预算为一的活动最终记录 `spent: 2`。本轮仅重新执行自动测试，未重跑 DSH。被测版本、测试命令与输出见 [验证记录](VALIDATION-2026-10-31.md)。

原议题 `ALEPH-03` 已合并至本议题，旧编号不再使用。失败任务是否消耗预算仍需另行确定。
