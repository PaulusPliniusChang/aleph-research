---
id: ALEPH-05
status: 已解决
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/6
pull_request: https://github.com/hapenia/aleph-research/pull/13
---

# DSH 重启后未完成任务缺少后续处理

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
