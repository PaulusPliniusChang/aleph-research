---
id: ALEPH-08
status: dsh实测有问题
type: 功能缺项
remote_issue: https://github.com/hapenia/aleph-research/issues/9
pull_request: https://github.com/hapenia/aleph-research/pull/31
---

# 任务完成后未自动继续剩余研究任务

## 当前修复与验收（2026-10-31）

[PR31](https://github.com/hapenia/aleph-research/pull/31) 已发布，准确修复提交为 `12325013bec147895a6b8e58c3b910bc239b78f9`，基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。本轮只允许 Leader 的 `aleph` 和 Composer 的 `aleph-composer` 预设调用 `aleph_run_infra`，并补充角色说明及产品测试。其他工具的角色条件继续保持原有范围。修复提交已经推送到派生仓库，拉取请求尚未合并。

**产品测试 47 项全部通过；B 的独立自动验收 40 个有效行为点全部通过，实际 DSH 验收 40 个有效行为点全部通过。** 产品结果包括 38 个新增有效行为点、2 个父测试容器及 7 项既有测试；独立自动与实际验收各有 1 个父测试容器另计。产品与独立检查没有重复相加。

实际模型输入已经包含 Infra 派发工具。Composer 实际调用 `aleph_run_batch` 两次、`aleph_run_infra` 一次；原生 Infra 子会话调用 `bash`，保存批次交接后完成计算。全部任务各计算一次，结果提交分别归属原任务分支。忙碌时批准的任务保留排队和原机器归属，完成后继续执行，后续审批复用原 Composer。实际模型记录没有 `missingRequiredInfra` 标志，本轮未采用缺少工具时的直接执行回退。

独立检查沿用下方入口。自动检查实际注册的权限谓词，服务流程使用替代存储、会话和确定性激活，Git、工作树、计算命令真实执行；实际检查使用已安装 DSH、原生子会话、持久存储和真实工具执行，本地确定性模型根据真实返回决定动作。隔离 YAML 仅为 Composer 子代理传输补充 `provider: spawn`，未改动产品 JavaScript。该验收验证 Host 的权限、路由和队列继续执行，不能代表外部模型的自主规划质量、忙碌机器的提前编排策略或多机器完整执行。最后实际 Host `557035` 正常退出，进程编号不存在。

证据：[产品日志](evidence/08-fixed-composer-product.txt)、[独立自动报告](evidence/08-fixed-composer-independent.json)及[日志](evidence/08-fixed-composer-independent.txt)、[实际 DSH 报告与模型调用](evidence/08-fixed-composer-real-dsh.json)及[日志](evidence/08-fixed-composer-real-dsh.txt)、[冻结文件清单](evidence/08-fixed-composer-manifest.json)、[修复补丁](evidence/08-fixed-composer-changes.patch)、[C 的冻结交接](evidence/08-fixed-composer-handoff.md)。清单与报告中的版本是修复前准确基线，B 导入后核对全部冻结文件哈希，再创建上述修复提交。原议题状态、失败证据和旧版历史继续保留。

## 最新架构正式核查（2026-10-31）

被测主分支为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。本轮执行 **40 个不同的自动行为检查点，39 个通过、1 个失败；实际 DSH 执行 40 个检查点，33 个通过、7 个失败**。父测试容器另计。失败集中在同一原因及其后续结果：**Composer 的实际模型工具清单缺少 `aleph_run_infra`，无法完成提示要求的基础设施优化调用。**

当前持续执行流程已有正常能力。实际 DSH 中，首项任务获批后，Host 自动启动 Composer；Composer 通过模型工具调用编排并启动任务。首项运行时，后续任务获得批准，原机器归属保持且后续任务不提前运行。完成首项后，Composer 能继续编排后续任务；直接执行路径还验证后续审批能够重新唤醒同一个 Composer，会话身份不变，计算和结果均各执行一次。旧版 `aleph_run_available` 与 campaign 排队步骤不适用，不能用旧版失败认定当前完全没有续调度。

当前仍有独立成立的流程缺口。Composer 提示要求调用 `aleph_run_infra`，注册条件却只允许 Leader 的 `aleph` 角色。初次实际链让 Composer 在编排后续批次后调用该工具，记录中没有任何 Infra 子会话，后续批次停在 `forming`、机器保持 `busy`，任务未运行。工具请求和状态均已保存。当前模型清单缺工具的证据与自动检查的实际注册 `when` 谓词一致。

最终实际检查在发现缺少 Infra 工具时明确记录该原因，并使用直接执行作为对照，因此队列任务仍能完成；该对照不算 Infra 路径通过。实际失败包括权限检查、Infra 激活和完成、交接文件、预期工具调用次数及真实 bash，均为同一缺口的依赖结果，不代表发现多项独立缺陷。最初不回退的实际链保存在独立记录中。修复验收应在同一脚本下取消自动触发的回退结果，使实际 Composer 能调用该工具、激活 Infra、保存交接并完成计算。

自动检查替代存储、会话与模型激活，实际运行 Git、工作树和计算命令。服务路径直接路由工具，角色权限通过真实注册谓词独立检查，未把绕过注册权限的服务调用认定为权限通过。实际检查使用 DSH `0.2.2-alpha.2`、原生子会话、注册工具和持久存储；本地确定性模型读取真实工具返回，明确测试直接执行和一条静态 Infra 交接路径，不据此评价模型调度判断。隔离配置为 Composer 的子代理工具补充 `provider: spawn`，匹配已安装 DSH 的必填要求，未修改产品 JavaScript。最后实际 Host `541578` 已退出，进程编号不存在。

测试入口：[联合自动与实际检查](dsh/current-composer-continuation.test.mjs)、[实际启动器](dsh/current-composer-continuation.py)、[确定性模型适配器](dsh/composer-continuation-bridge.mjs)。正式结果：[自动报告](evidence/08-current-automatic.json)、[自动日志](evidence/08-current-automatic.txt)、[实际报告及模型工具清单](evidence/08-current-real-dsh.json)、[实际日志](evidence/08-current-real-dsh.txt)。未回退的缺陷路径见[实际超时报告](evidence/08-current-infra-unavailable-attempt.json)及[日志](evidence/08-current-infra-unavailable-attempt.txt)，报告保留缺少 Infra 时的批次状态和原始模型上下文。

初始夹具误用 manifest 标识代替持久 mission 标识，以及把批次交接文件当作任务分支文件；[标识尝试](evidence/08-current-identity-fixture-attempt.json)、[交接尝试](evidence/08-current-handoff-fixture-attempt.json)均保留，属于检查脚本错误。诊断接口的工具视图包括禁用工具，最终权限检查已改为实际模型输入中的工具清单；[诊断视图尝试](evidence/08-current-diagnostic-visibility-attempt.json)另存，不作为权限通过依据。

复跑命令：

```bash
ALEPH_CURRENT_SOURCE=/path/to/current-source ALEPH_COMPOSER_OUTPUT=/tmp/composer.json node --test tests/issues/dsh/current-composer-continuation.test.mjs
python3 tests/issues/dsh/current-composer-continuation.py --source /path/to/current-source --output /tmp/composer-real.json
```

自动检查需要被测副本能够解析已安装 DSH 的依赖。当前缺陷补充到原议题，旧版历史证据与管理状态保留，不新建重复议题。忙碌机器的提前编排策略和多机器执行均不在已通过范围。

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `6688599`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版依赖 campaign 队列、`aleph_run_available` 和研究任务完成回调。当前流程改为提案、审批、批次编排与执行，自动推进的预期行为需要重新确认。

本轮只核对源码入口、模型差异和远端链接，尚未完成针对当前版本的至少 30 个测试点及真实 DSH 复测。原有状态和历史证据保留；该状态不代表当前版本已经复现。远端议题已经存在，本轮没有重复上传。完整范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 问题

任务完成并释放容量后，系统没有自动推进剩余队列。研究需要再次调用派发工具才能继续，缺少持续执行流程。

## 复现

1. 设置并发上限为 `1`，不限制预算，将任务甲和任务乙加入队列。
2. 调用一次 `aleph_run_available`。
3. 等待首个任务完成评测和清理，不再发送消息或调用派发工具。
4. 等待约 90 秒，再查询状态。

## 实际结果

状态仍为 `active_agents: 0`、`queued: 1`、`done: 1`，剩余任务没有自动启动。自动测试中显式再次派发能够完成后续任务。

## 预期结果

容量释放后自动继续队列，并将结果反馈给 Leader 以决定后续研究。执行过程遵守预算、目标和人工停止条件，同一任务不会重复派发。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，观察范围为首个任务完成后约 90 秒。证据见 [持续执行记录](evidence/08-real-dsh-continuation.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。报告内容由 [ALEPH-10](10-mission-reports.md) 处理，人工控制由 [ALEPH-09](09-campaign-controls.md) 处理。
