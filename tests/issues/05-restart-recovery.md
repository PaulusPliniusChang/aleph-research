---
id: ALEPH-05
status: 已解决
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/6
pull_request: https://github.com/hapenia/aleph-research/pull/29
---

# DSH 重启后未完成任务缺少后续处理



## 项目控制与重启恢复的组合验收（2026-10-31）

组合补丁以 PR #26 的准确提交 `b1f9f048ae8cc7569e6a9e36dcafe119f2c02783` 为基础，整合 PR #29 的启动恢复与持续收尾行为。普通启动仅观察持久执行回执，不创建停止文件或取消意图；明确取消仍执行停止协议。原有五秒定时器仅跟踪首次启动捕获的执行，计算自然结束后记录中断、保留输出并释放准确机器归属；项目已经处于结束等待状态时，随后进入结束状态。

| 验收范围 | 结果与证据 |
| --- | --- |
| 完整产品测试 | Node 262／262 通过，包含 232 个有效行为点与 30 个父测试容器。见[产品输出](evidence/09-combined-product.txt)。 |
| B 独立自动验收 | 105 个有效行为点全部通过；Node 连同父容器为 106 项。见[结构化记录](evidence/09-combined-independent.json)和[原始输出](evidence/09-combined-independent.txt)。 |
| 实际 DSH | 105 个有效观察点全部通过；Node 连同父容器为 106 项。见[实际记录](evidence/09-combined-real-dsh.json)和[原始输出](evidence/09-combined-real-dsh.txt)。 |

实际流程使用真实注册工具、持久存储、Git 工作树及 Python 批次运行器，直接对原 Host 发送 `SIGKILL`，再使用相同 `DSH_HOME` 启动。计算进程在恢复后继续存在，机器与执行身份保持准确，批次不能重复计算。暂停和结束等待均不停止该计算。计算自然退出后，脚本等待至少 6100 毫秒，由产品原有五秒定时器完成收尾，任务结果及源码仍可检查。另一场景在普通恢复后明确取消批次，确认停止文件存在、原计算退出、取消终态持久化、机器准确释放、工作树和诊断保留；再次重启仍保持取消状态。已交付成果和未运行批次分别作为正常对照。

独立脚本沿用磁盘存储适配器及真实插件启动，实际阶段使用原始 DSH，没有调用模型、改变产品期限或直接调用收尾方法。冻结产品文件在验收后逐项核对摘要一致。[冻结清单](evidence/09-combined-source-manifest.json)与[交接说明](evidence/09-combined-source-handoff.md)保留。所有实际 Host 的进程编号均已确认不存在。

首次独立夹具错误读取顶层项目状态，另有终态拒绝信息沿用旧预期；相关记录分别保存在[状态路径尝试](evidence/09-combined-state-contract-fixture-attempt.json)和[拒绝信息尝试](evidence/09-combined-error-message-fixture-attempt.json)，原始输出均一并保存。最终夹具使用 `control.state` 与当前明确拒绝契约，105 个有效点全部通过。这些尝试属于夹具修正，不计作产品缺陷。

复跑使用[独立脚本](dsh/combined-controls-restart.test.mjs)和[实际启动脚本](dsh/combined-controls-restart.py)。支持范围保持单 Host 写入、Linux 可读进程信息及留在所属进程组中的普通后代；恢复不新增自动成果交付、重复计算或跨 Host 执行服务。原人工管理状态及已发布历史证据继续保留。


## 最新残留修复与正式验收（2026-10-31）

当前修复已发布为 [PR #29](https://github.com/hapenia/aleph-research/pull/29)，开放且尚未合并。原 PR #13 保留为历史，不将关闭解释为已经合并。

修复提交为 `96226147cd18f67ea9920f0e714532259295bdce`，派生仓库分支为 `fix/aleph-05-restart-followup`。本轮修复以 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 为基线，保留合法 `forming` 批次的机器占用，并只跟踪首次启动时发现的 `running` 遗留批次。当前五秒监控在真实计算退出后将遗留批次明确标为中断，保留结果及工作树，释放仍然属于原批次的机器。后续新启动的代理不进入原有启动快照，定时器不会反复关闭所有运行代理。已经完成但未交付的结果仍按允许的中断契约处理，没有恢复旧版监督程序或强制自动交付。

正式验收结果如下：

| 验收范围 | 结果 | 证据 |
| --- | --- | --- |
| 产品自动测试 | 56／56 通过，其中新增有效点 41 项、新增父容器 8 项、既有测试 7 项。 | [原始输出](evidence/05-fixed-followup-product.txt) |
| B 独立自动验收 | 66 个有效行为点全部通过；Node 包含父容器为 67 项。 | [结构化结果](evidence/05-fixed-followup-automatic.json)、[原始输出](evidence/05-fixed-followup-automatic.txt) |
| 实际 DSH 验收 | 66 个有效观察点全部通过；Node 包含父容器为 67 项。 | [实际记录](evidence/05-fixed-real-dsh-followup.json)、[原始输出](evidence/05-fixed-real-dsh-followup.txt) |

[独立脚本](dsh/fixed-restart-followup.test.mjs)沿用真实 Git、Python runner、受控任务和实际主进程异常退出场景。自动阶段使用磁盘存储适配器并执行真实插件启动；[实际启动脚本](dsh/fixed-restart-followup.py)使用同一 `DSH_HOME` 中的真实持久存储、注册工具与认证接口。实际验收没有调用模型、修改产品源码、缩短产品期限或手动调用持续收尾方法。

未运行批次重启后保持 `forming` 与机器占用，同机器再次编排明确被拒绝，原批次归属保持。活跃批次在原 Host 被 `SIGKILL` 后继续实际计算；首次重启保留运行状态和准确机器占用。任务完成并确认相关进程退出后，脚本记录退出确认时间和不少于 6100 毫秒的观察窗口，当前 Host 的原有五秒监控完成中断写入与机器释放，无需再次重启。任务源码提交不变，结果文件保留，执行计数仍为一次。再次重启保持终态稳定。

计算在 Host 缺席期间完成的场景保持明确中断、结果保留和重试拒绝；正常交付完成的场景保持 `done`、结果提交及任务分支稳定。进程退出观察中，尚未被父进程回收的僵尸进程记录与活跃状态分别保存；启动脚本结束后全部 Host 进程均不存在，见[来源与清理记录](evidence/05-fixed-followup-source-manifest.json)。

进程归属仍以 Linux `/proc` 中可读取的工作目录为边界，不能保证识别主动切换目录或工作目录不可读取的所有进程，也不承诺多个 Host 共同写入项目的一致性。原 [PR #26](https://github.com/hapenia/aleph-research/pull/26) 另有控制与恢复改动，本轮单独修复尚未完成与该请求的组合验收；不能将独立通过直接作为组合通过的证据。本地原有“已解决”状态保留，不代表上游已经合并。

## 最新架构正式复核（2026-10-31）

当前上游基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。原 [PR #13](https://github.com/hapenia/aleph-research/pull/13) 已关闭且没有合并，上游使用启动时对账替代原方案。后文的旧修复与验收仅作为历史记录；本地“已解决”管理状态保持原值，不表示当前残留已经修复。

当前实现能够在启动时把没有实际计算进程的遗留 `running` 批次明确标为中断，释放机器，并保留完成结果供排查。该行为符合原议题允许明确中断并保留依据的范围，本次不要求所有已经完成的结果自动交付。正常交付完成的批次重启后也保持完成、提交稳定，不重复计算。当前残留集中在合法待运行批次的机器占用，以及首次启动时仍活跃的遗留计算结束后的后续收尾。

### 已证实的残留

尚未启动的 `forming` 批次已经占用本地机器。重启后，Host 保留该批次的可运行状态和任务归属，却将机器改为空闲并清除占用批次。随后另一个已批准任务能够形成新批次，并再次占用同一台机器，原批次仍可运行。该过程说明批次状态与机器占用已经不一致；本轮没有同时启动原批次和新批次，不据此声称已经观察到计算资源超配。

如果批次正在计算时 Host 异常退出，实际 runner 和任务进程能够继续运行。第一次重启会正确保留 `running` 批次和机器占用。但是实际计算随后完成，runner 写出 `done` 结果且相关进程全部退出，等待 6100 毫秒、经过至少一个当前 5000 毫秒进程监控周期后，批次仍为 `running`，机器仍为 `busy`，任务没有结果提交。再次重启才会将该批次标为中断并释放机器。本轮有界观察证实该窗口内没有收尾，结合启动恢复只调用一次的源码路径，不能把当前进程监控视为持续恢复。

预期行为是保留合法待运行批次的机器占用，或显式撤销其可运行资格并准确处理归属；对首次启动保留下来的实际计算，Host 应在计算退出后收敛终态并释放占用。定时处理应只跟踪本次启动遗留的执行，避免把后续新启动的研究代理当作旧代理中断。无法自动交付时可以明确记录中断并保留结果，不要求重建旧版监督与交付架构。

### 当前双阶段核查

[独立自动脚本](dsh/current-restart-reconcile.test.mjs)使用磁盘存储适配器、真实 Git、真实 runner、受控任务以及单独执行进程的 `SIGKILL`，并调用真实产品启动入口。[自动记录](evidence/05-latest-restart-reconcile.json)及[原始输出](evidence/05-latest-restart-reconcile.txt)包含 62 个有效观察点，全部符合缺陷与正常对照预期；Node 包含父容器为 63 项。观察通过表示残留已复现，不表示修复通过验收。

[实际 DSH 启动脚本](dsh/current-restart-reconcile.py)在相同 `DSH_HOME` 中重启真实 Host，使用实际注册工具、持久存储、认证接口、Git、Python runner 和任务进程。[实际记录](evidence/05-latest-real-dsh-restart-reconcile.json)及[原始输出](evidence/05-latest-real-dsh-restart-reconcile.txt)同样包含 62 个有效观察点，全部符合预期。检查覆盖未执行批次、Host 缺席期间完成、首次重启时仍活跃，以及原本已经正常交付的批次。真实 Host 与测试启动的后续 Host 均已停止，没有重复启动任务。脚本没有调用模型、修改产品源码或改变产品期限。

完成但尚未交付的场景中，任务结果被保留，明确的中断原因可见，终态重试被拒绝且没有删除结果；该部分作为正常对照。当前场景只使用准确工作目录下的真实进程，没有注入无法确认归属的进程，不声称覆盖该边界。

首次自动夹具错误打开了工作目录下的空存储，相关[路径错误记录](evidence/05-latest-reconcile-table-path-fixture-attempt.json)与[原始输出](evidence/05-latest-reconcile-table-path-fixture-attempt.txt)单独保留。首次实际夹具把尚未被 Python 父进程回收的已退出僵尸进程当作活跃 Host，相关[进程观察错误记录](evidence/05-latest-real-dsh-reconcile-zombie-fixture-attempt.json)与[原始输出](evidence/05-latest-real-dsh-reconcile-zombie-fixture-attempt.txt)单独保留。最终夹具按实际 `/proc` 状态区分进程退出与回收，正式轮次完整通过；首次尝试均不计作产品失败。来源与准确范围见[当前来源记录](evidence/05-latest-reconcile-source-manifest.json)。

## 修复与复测（2026-10-31）

修复提交为 `f057a84`，已经推送到派生仓库分支 `fix/aleph-05-project-restart-recovery`，上游 [PR #13](https://github.com/hapenia/aleph-research/pull/13) 尚未合并。按现有规则，已有拉取请求即可设置“已解决”；该状态不表示上游已经发布修复。

修复在启动批次前持久化运行状态，通过每批次独立监督程序保存执行结果，并在插件启动与定时检查时恢复交付。Linux `/proc` 用于识别本地实际进程；计算仍活跃时保留机器占用，无法确认执行状态时保守处理。Git 结果标识用于避免重复提交，工作区保留供恢复交付和排查故障。监督程序随批次结束，不需要额外部署常驻服务。

B 对冻结后的改动独立复测，结果如下：

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| 独立恢复自动验收 | 67 个行为点全部通过；Node 计入父容器后为 68/68，无跳过。 | [完整报告](evidence/05-recovery-acceptance-repaired.txt)、[结构化记录](evidence/05-recovery-acceptance-repaired.json) |
| 产品自动测试 | `npm test` 的 52 项测试全部通过。 | [完整报告](evidence/05-product-repaired.txt) |
| 真实 DSH，计算完成后重启 | 50 项检查全部通过，包含恢复交付、显式重试和第二次重启。 | [实测记录](evidence/05-repaired-real-dsh-completed.json) |
| 真实 DSH，计算仍活跃时重启 | 57 项检查全部通过；实际计算结束前机器保持占用，没有重复启动任务。 | [实测记录](evidence/05-repaired-real-dsh-live.json) |

增强后的独立验收增加同批次并发、Git 已交付但持久存储尚未写入、部分任务交付、确定性 Git 引用锁故障和真实旧版 `forming` 状态兼容。未修复主仓库的同套 67 点基线为 42 个通过、25 个失败，见[基线报告](evidence/05-recovery-acceptance-67-baseline.txt)与[结构化记录](evidence/05-recovery-acceptance-67-baseline.json)。自动验收使用磁盘适配器，真实 DSH 实测另外使用实际工具和持久存储，均不调用模型。

首轮修复验收有 11 个断言失败，原因是夹具在 `result.json` 写入后立即读取恢复结果，实际 runner 与监督程序尚未退出；恢复保留机器占用符合要求。夹具改为观察实际进程退出后再断言终态，随后 67 点全部通过。该次同名原始报告已被重跑覆盖，现存完整报告仅对应修正后的执行，首轮结果只保留为此处说明。真实 DSH 首次启动另遇诊断插件路由尚未注册的环境时序问题，相关[启动记录](evidence/05-repaired-dsh-bridge-startup-race.json)保留；脚本对该路由的短暂 404 增加有界等待后完成实测，未将该错误计作产品缺陷。

修复验收命令将下述自动测试的 `ALEPH_CURRENT_SOURCE` 改为 `/home/paulus-chang/项目/aleph-fix-restart`。真实 DSH 脚本使用同一修复工作区并增加 `--expect-recovery`；活跃计算场景另外增加 `--restart-live`。测试在提交前对冻结内容执行，提交后的产品文件与被测内容一致。实际 DSH 服务均在场景结束后停止。

## 与重复优化修复的组合复测

重复优化修复 [PR #15](https://github.com/hapenia/aleph-research/pull/15) 依赖本议题的 [PR #13](https://github.com/hapenia/aleph-research/pull/13)，组合提交为 `be646b3`。B 对组合内容另外完成 168 项产品测试、67 个独立恢复行为点、65 个独立优化行为点，以及实际 DSH 的计算完成后重启 50 项检查和活跃孤立计算重启 57 项检查，均通过。活动优化经历定时恢复扫描的实际场景也通过，机器没有提前释放。完整结果和范围见 [ALEPH-13](13-infra-duplicate-start.md#组合修复与复测2026-10-31)，记录见[组合恢复自动验收](evidence/13-combined-restart.txt)、[完成后重启](evidence/13-combined-real-dsh-restart-completed.json)和[活跃计算重启](evidence/13-combined-real-dsh-restart-live.json)。前置请求尚未合并，原有提交与证据保持。

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `66885994ceadad83a237a27c1fc7de6419889c14`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。当前版本已经通过独立自动测试与真实 DSH 环境复测，确认批次执行期间主进程退出后缺少恢复处理，且显式重试会先删除已完成的结果目录，再因 Git 工作区登记残留而失败。

自动验收覆盖 41 个恢复相关测试点，结果为 27 个通过、14 个失败；Node 测试报告额外计入父测试容器，显示 42 个测试、15 个失败。真实 DSH 场景的 38 个观测检查均通过，含义为缺陷已复现，不能解释为修复已经通过验收。原有状态与旧版历史证据保留；远端议题继续使用 [#6](https://github.com/hapenia/aleph-research/issues/6)。完整架构范围见[架构适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 当前版本问题与复现

1. 使用真实 DSH `0.2.2-alpha.2` 创建项目，将确定性任务提案、审批并编排到批次，任务执行有明确结束时间，不调用模型。
2. 调用 `aleph_run_batch`，确认真实 Python runner 与任务 shell 已经执行，然后只对 DSH 主进程发送 `SIGKILL`。
3. 通过实际进程记录确认 runner 在主进程退出后继续运行，等待任务完成、`result.json` 写入并确认执行进程全部退出。
4. 使用相同 `DSH_HOME` 重启真实 DSH，读取项目状态与 mission 分支。
5. 对原批次显式重试，再次检查结果文件、Git 工作区登记及项目状态。

重启后，同一批次仍为 `forming`，任务仍为 `batched`，机器仍为 `busy`。任务没有结果提交或结束时间，mission 分支没有变化，已完成结果只存在于原批次工作区。再次调用运行工具时，代码先删除批次目录，再执行 `git worktree add`；Git 随后报告工作区已经登记但目录缺失，重试失败，唯一结果文件已经删除，机器仍未释放。

主进程退出不表示计算进程已经结束；恢复处理必须先确认真实执行状态。DSH 的子会话还具有持久化恢复能力，因此不能仅凭常驻子代理缺失判定会话不可恢复。尚未运行的合法 `forming` 批次也不能直接标记为中断。

## 当前版本验收与证据

自动测试直接调用当前 `ProjectService` 与插件启动入口，使用磁盘 JSON 存储适配器、真实 Git 仓库、真实 runner 和异常退出进程。自动测试不声称使用真实 DSH 存储；真实 DSH 场景单独完成环境核查。

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_RECOVERY_OBSERVATIONS=/home/paulus-chang/项目/aleph-tests/tests/issues/evidence/05-recovery-acceptance-baseline.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/restart-recovery-acceptance.test.mjs

python3 tests/issues/dsh/current-restart.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/05-current-real-dsh-restart.json
```

自动验收覆盖正常完成、已经交付结果的重启、执行结束但主进程尚未交付、重复启动、显式重试、仍在运行的孤立计算进程、孤立进程完成后的恢复，以及 Git 交付失败。失败集中在终态恢复、机器释放、结果交付和重试现场保留。修复验收还需覆盖并发运行、部分任务交付和 Git 已提交但存储尚未写入的中断窗口。

证据与脚本：[自动验收脚本](dsh/restart-recovery-acceptance.test.mjs)、[自动验收原始报告](evidence/05-recovery-acceptance-baseline.txt)、[自动验收结构化记录](evidence/05-recovery-acceptance-baseline.json)、[真实 DSH 复现脚本](dsh/current-restart.py)、[真实 DSH 记录](evidence/05-current-real-dsh-restart.json)。恢复应避免重复计算与重复提交，在真实计算退出之前保留机器占用；无法交付时应明确记录失败并保留排障依据。

## 旧版历史记录

## 问题

任务启动后会保存为 `running`，但等待研究代理完成、提交、评测和清理的流程只存在于当前进程中。DSH 重启后没有恢复处理，任务可能一直显示为运行中。

## 复现

1. 启动真实研究任务，确认状态为 `running`。
2. 在任务完成前以 `SIGKILL` 结束 DSH 进程。
3. 使用相同 `DSH_HOME` 重启，查询任务状态及遗留工作目录。

## 实际结果

任务创建约六分钟后仍为 `running`，对应子代理已不存在；任务没有提交、评分或完成时间，工作目录仍保留。

## 预期结果

重启后检查未完成任务，恢复可继续的处理；无法恢复时明确标记中断并处理遗留目录。已经完成的提交、评测与预算记录不应重复执行。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，覆盖进程异常退出场景。证据见 [重启记录](evidence/05-real-dsh-restart.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。正常运行时的人工控制另见 [ALEPH-09](09-campaign-controls.md)。

## 公开证据

议题文档、复跑脚本与验收记录已经发布到派生仓库的独立证据分支 `evidence/2026-10-31-validation`，固定提交为 `23f4c0f67f78c39639c9d3a877b337e3907b7499`，入口见[公开证据目录](https://github.com/PaulusPliniusChang/aleph-research/tree/23f4c0f67f78c39639c9d3a877b337e3907b7499/tests/issues)。该分支以当前 `main` 为基础，仅加入已经提交的 `tests/issues` 文件，没有加入旧测试分支的产品实现或用户未提交测试改动。本地管理字段和注释保持，GitHub 议题正文不包含管理头和前导注释。
