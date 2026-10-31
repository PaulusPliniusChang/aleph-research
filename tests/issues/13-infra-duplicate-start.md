---
id: ALEPH-13
status: 已解决
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/14
pull_request: https://github.com/hapenia/aleph-research/pull/15
---

# 同一批次重复启动 InfraOptimizer 会删除正在使用的工作目录


## 当前准备窗口的修复验收

最新控制修复提交 `b1f9f048ae8cc7569e6a9e36dcafe119f2c02783` 在目录操作前取得批次执行权，同时处理本议题准备窗口。B 对项目控制及本窗口运行组合套件：独立自动共 75 个有效行为点、实际 DSH 共 77 个有效观察全部通过，重启另有 12 项通过。上述数量属于组合套件，不能理解为本议题独有数量。

与本议题直接相关的实际观察包括：首请求在激活记录建立前已经持有执行权；第二请求在目录操作前被拒绝；第二次 Git 创建没有发生；首目录 inode、标记及首请求保持；释放首个真实 Git 响应后，真实 InfraOptimizer 执行 Bash 写入文件；整批取消后对应激活被释放，修改和目录保留，机器释放且没有虚构任务结果。详细范围、配置适配、失败历史及全部证据见[项目控制修复验收](09-campaign-controls.md#当前修复验收)。

本地人工“已解决”状态继续保留。旧 PR #15 的历史链接保留为旧方案，当前修复使用新的控制操作拉取请求。

原始准备窗口记录的 `probe.boundary` 误写为启动真实研究代理；该场景实际使用真实父会话与任务工作树工具，没有启动研究代理或基础设施优化模型。原始记录保持不变，说明更正见[边界更正记录](evidence/13-current-preparation-boundary-correction.json)。
## 最新上游复核：准备阶段仍存在重复启动窗口

本地“已解决”是先前人工维护状态，按状态规则继续保留；该字段不代表当前上游准备阶段已经修复。当前复核证据及待修复范围以下文为准。

上游主分支现为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。上游已关闭原 PR #15，未合并原方案，并以项目内同角色运行记录替代旧方案。原修复验收保留为历史，不能表示该上游实现已完整通过复核。

新 `claimRole` 能拒绝已经保存 `running` 记录的重复请求，但首请求需要先完成 Git 工作区准备和代理启动，随后才写入该记录。B 已通过自动行为检查及实际 DSH 证实：首请求已经创建批次工作区、尚未登记代理时，重复的同批请求仍会删除首请求的目录，随后因 Git 保留了首工作区登记而失败。第一请求继续后，真实 DSH 因工作目录不存在而失败。批次仍为 `forming`，机器仍为 `busy`，任务没有结果提交。当前需要保护的是准备阶段；此次实测没有启动 InfraOptimizer 模型，也没有声称丢失模型已经编写的优化代码。

### 精确调度与证据边界

[Git 调度脚本](dsh/infra-preparation-git-scheduler.py)只匹配当前批次的完整 `git -C <missionRoot> worktree add --detach <infraWorktree> <batchBranch>` 参数。调度器先执行真实 Git，第一调用成功后延迟向 Host 返回结果，第二调用按原样执行。测试释放第一调用时，Host 继续原始流程。调度器没有修改源码、Git 输出、返回码、删除操作、存储或角色记录；最大等待时间为 25 秒。测试在首目录放置的标记只用于证明目录被删除，不属于代理生成的产物。

实际记录中，首次 Git 创建成功；第二次 Git 返回 `128`，错误为 `missing but already registered worktree`，其完成时间早于首调用获准返回。首目录及标记均被删除，首请求仍在等待。释放首请求后，DSH 返回 `working-directory: directory does not exist`。该时序证明防护晚于目录准备，不能用代理已经运行后的顺序拒绝结果替代该场景。

### 自动行为检查

```bash
PATH=/tmp/aleph-13-current-auto-gate/bin:$PATH ALEPH_INFRA_PREPARATION_GATE=/tmp/aleph-13-current-auto-gate ALEPH_INFRA_PREPARATION_OUTPUT=tests/issues/evidence/13-current-preparation-baseline.json node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs --test tests/issues/dsh/current-infra-preparation.test.mjs
```

运行前，测试创建空调度目录及 `bin/git` 链接，目标为上述 Git 调度脚本。[自动脚本](dsh/current-infra-preparation.test.mjs)覆盖实际项目初始化、独立任务工作区、真实提案和审批、批次编排、机器归属、准备目录、重复请求、Git 时序、首请求恢复及结果记录。自动模式明确替换存储、会话、预设和代理启动服务；Git、文件系统及原始注册工具函数真实执行。

36 个有效行为点中，32 个通过、4 个失败；Node 连同父容器报告 37 项、32 项通过、5 项失败。失败涉及重复请求提前拒绝、首目录及标记保留，以及首请求继续可用。自动启动适配器在目录已丢失时返回明确的目录不存在错误；该错误属于适配器行为，真实 DSH 的同类错误由下一阶段独立证明。原始证据见[自动输出](evidence/13-current-preparation-baseline.txt)和[完整记录](evidence/13-current-preparation-baseline.json)。

### 实际 DSH

```bash
python3 tests/issues/dsh/current-infra-preparation.py --source /home/paulus-chang/项目/aleph --output tests/issues/evidence/13-current-real-dsh-preparation.json
```

[启动脚本](dsh/current-infra-preparation.py)使用真实 DSH 会话、注册工具、持久化存储、Git 及目录验证服务，同样只调度上述真实 Git 响应。36 项观察全部符合复现条件；真实目录验证直接拒绝首请求，不依赖自动模式的启动适配器。模型适配器虽已配置，InfraOptimizer 没有成功进入模型执行。审批时 Composer 启动另报 `provider` 配置缺值，已保存在代理记录中；本场景手动调用正式批次及优化工具，不能声称已验证 Composer 自动派发。

原始证据见[实际输出](evidence/13-current-real-dsh-preparation.txt)和[完整 Git 时序、错误及最终状态](evidence/13-current-real-dsh-preparation.json)。隔离 Host `325121` 已退出，进程编号不存在。此前已通过的旧组合修复证据保持原样，当前复核没有重开旧方案。新的控制修复如果同时关闭准备窗口，应在同一修复 PR 中关联本议题并补齐该窗口的修复验收。

## 组合修复与复测（2026-10-31）

最终修复提交为 `be646b3`，派生仓库分支为 `fix/aleph-13-infra-recovery`，上游拉取请求为 [PR #15](https://github.com/hapenia/aleph-research/pull/15)。该请求依赖重启恢复 [PR #13](https://github.com/hapenia/aleph-research/pull/13)，当前分支包含前置提交 `f057a84`。主仓库尚未合并前置请求，因此本次没有另建独立原型的拉取请求。按现有规则，已经创建解决方案的拉取请求即可设置“已解决”；该状态不表示上游已经合并或发布。

组合修复沿用独占执行与持久化阶段，并与恢复流程共用启动保护。优化交接到实际 runner 之间不会释放执行权；恢复扫描跳过活动优化，保留机器占用。重启后遗留的 `infra` 阶段会保留现场并拒绝直接重跑，自动接续优化会话不属于本次承诺范围。前置修复的 Linux `/proc` 进程识别、每批次监督程序、计算恢复和幂等交付继续有效。

B 对 C 冻结的组合内容串行独立验收，结果如下。提交后的内容与[冻结文件摘要](evidence/13-combined-frozen-content.json)一致。

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| 产品完整自动测试 | 168/168 全部通过，无跳过。 | [产品报告](evidence/13-combined-product.txt) |
| 独立优化自动验收 | 65 个行为点全部通过，Node 含父容器为 66/66。 | [报告](evidence/13-combined-infra.txt)、[结构化记录](evidence/13-combined-infra.json) |
| 独立恢复自动验收 | 67 个行为点全部通过，Node 含父容器为 68/68。 | [报告](evidence/13-combined-restart.txt)、[结构化记录](evidence/13-combined-restart.json) |
| 实际 DSH，活动优化经历恢复扫描后重复优化 | 63/63，通过。 | [实测记录](evidence/13-combined-real-dsh-duplicate.json) |
| 实际 DSH，活动优化期间直接运行 | 45/45，通过。 | [实测记录](evidence/13-combined-real-dsh-direct.json) |
| 实际 DSH，计算期间重复调用优化和直接运行 | 55/55，通过。 | [实测记录](evidence/13-combined-real-dsh-running.json) |
| 实际 DSH，计算完成后重启 | 50/50，通过。 | [实测记录](evidence/13-combined-real-dsh-restart-completed.json) |
| 实际 DSH，孤立计算仍活跃时重启 | 57/57，通过。 | [实测记录](evidence/13-combined-real-dsh-restart-live.json) |

实际 DSH 优化场景沿用下文说明的本地确定性模型适配器；重启场景使用真实 shell 任务，不调用模型。所有场景使用独立状态目录，结束后均停止隔离服务。优化与直接运行的重复请求均在目录操作前得到明确的活动执行拒绝，原任务只计算一次，Git 历史只包含一次结果交付。

组合验收在 `/home/paulus-chang/项目/aleph-fix-infra-recovery` 执行产品 `npm test`。独立自动命令将 `ALEPH_CURRENT_SOURCE` 改为该工作树，恢复自动命令使用 [恢复验收脚本](dsh/restart-recovery-acceptance.test.mjs)。实际 DSH 优化命令分别增加 `--duplicate --expect-protection --hold-for-recovery`、`--direct-during-infra --expect-protection`、`--duplicate-during-runner --expect-protection`。恢复场景使用 [真实重启脚本](dsh/current-restart.py)，增加 `--expect-recovery`，活跃计算场景再增加 `--restart-live`。每份结构化记录保存执行命令、被测来源和替代范围。

## 独立修复验收（2026-10-31）

基于当前 `main` 的独立修复保存在提交 `2eeaee8`，工作树为 `/home/paulus-chang/项目/aleph-fix-infra`，分支为 `fix/aleph-13-infra-duplicate-start`。该提交尚未推送，也尚未创建拉取请求。B 对 C 冻结的产品文件完成独立验收，提交内容与[冻结内容摘要](evidence/13-repaired-frozen-content.json)中的文件摘要一致。

修复为优化与直接运行入口共用同一批次执行权，在目录操作前登记独占持有者，并持久化 `running` 状态和 `infra`、`batch` 阶段。优化流程把执行权交给内部批次方法，直到计算、交付和清理结束才释放。服务重新创建后，对持久化运行状态明确拒绝重复请求；本次独立修复不实现优化会话的重启恢复。

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| 独立自动验收 | 65 个行为点全部通过，Node 含父测试容器为 66/66，无跳过。 | [报告](evidence/13-infra-duplicate-repaired.txt)、[结构化记录](evidence/13-infra-duplicate-repaired.json) |
| 产品自动测试 | `npm test` 的 75 项全部通过，无跳过。 | [产品报告](evidence/13-product-repaired.txt) |
| 实际 DSH，活动优化期间重复优化 | 44 项检查全部通过，活动文件保持，原流程正常完成。 | [实测记录](evidence/13-repaired-real-dsh-duplicate.json) |
| 实际 DSH，活动优化期间直接运行 | 44 项检查全部通过，直接入口明确拒绝提前计算。 | [实测记录](evidence/13-repaired-real-dsh-direct.json) |
| 实际 DSH，实际计算期间重复调用 | 54 项检查全部通过，优化与直接运行入口均拒绝重复，原运行目录身份与文件保持。 | [实测记录](evidence/13-repaired-real-dsh-running.json) |

实际 DSH 场景均确认真实子会话身份和工具执行；最终实际计算只执行一次，任务结果成功交付。测试仍使用下文说明的本地确定性模型适配器，场景结束后均已停止隔离服务。命令将被测目录改为独立修复工作树；实际 DSH 分别增加 `--duplicate --expect-protection`、`--direct-during-infra --expect-protection` 或 `--duplicate-during-runner --expect-protection`。

独立原型与重启恢复修复的合并冲突随后由 C 处理；组合验收与最终发布结果见上节。

## 当前情况

研究代理把需要较多计算资源的工作封装为 mission，Leader 审批后，Composer 把任务合成 batch。Leader 调用 `aleph_run_infra`，InfraOptimizer 在批次工作目录中修改程序，Host 随后执行批次并把结果交付到任务分支。

当前代码只在 `runInfra` 入口检查批次是否为 `forming`。首个优化代理启动后，Host 只登记代理记录，没有把批次改为运行中，也没有为该批次登记独占执行权。同一批次在首个优化代理仍活动时收到第二次调用，仍可通过检查。Host 随后强制删除按批次编号命名的同一工作目录。

检查版本为 `66885994ceadad83a237a27c1fc7de6419889c14`，日期为 2026 年 10 月 31 日。建议优先级为 P1。B 已完成自动测试与真实 DSH 环境复现，并依据用户授权发布上游 [#14](https://github.com/hapenia/aleph-research/issues/14)。修复与验收结果见上述 [PR #15](https://github.com/hapenia/aleph-research/pull/15)。

## 使用例子与触发步骤

例如，批次 `b-123` 包含已经审批的训练任务。首个 InfraOptimizer 正在 `.aleph/infra/b-123` 中读取代码、修改训练脚本，并准备交接说明。

1. 按当前 project、mission、batch 流程创建项目、提案、审批并编排批次。
2. Leader 调用 `aleph_run_infra`，等待首个真实优化代理启动，确认代理仍在活动，工作目录中已有本轮文件。
3. 在首个代理返回之前，另一个 Leader 会话针对相同 `project_id` 和 `batch_id` 再次调用 `aleph_run_infra`。
4. 观察第二次调用是否在修改目录之前被拒绝，同时检查首个代理的工作目录、文件、后续执行和结果交付。

该触发路径不需要重启 DSH，也不需要绕过 InfraOptimizer 直接运行批次。单次调用不满足重复启动的触发条件。

## 实测行为与影响

第二次调用通过 `forming` 检查后，先对 `.aleph/infra/<batch-id>` 执行递归强制删除，再尝试创建 Git 工作目录。首个代理仍在使用该目录，代码、未提交修改或交接说明可能因此消失。

第二次调用即使随后因 Git 工作目录登记冲突而失败，前面的删除也已经发生。实际 DSH 复现中，首个真实子会话仍在等待时，第二次请求删除交接说明、受版本管理的修改和嵌套目录中的标记文件。第二次请求随后因 Git 工作区已经登记而失败。释放首个子会话后，首个 Host 流程也失败，批次保留为 `forming`，机器保留为 `busy`，任务没有结果；批次计算没有启动。已经完成的优化工作因此丢失。

该问题涉及正在使用的工作目录被重复启动请求删除。InfraOptimizer 对批次程序、存储和清理方式的决定不属于本议题要求改变的范围。

## 预期行为

同一批次首次启动优化后，应取得该批次的独占执行权。后续重复请求应返回已经启动的执行记录，或在任何目录修改之前明确拒绝。优化转入实际批次运行时，独占执行权应继续有效，直到结果交付和本轮结束处理完成。

## 当前证据与限制

验证日期为 2026 年 10 月 31 日。被测源码提交为 `66885994ceadad83a237a27c1fc7de6419889c14`，被测产品没有受版本管理的本地改动。真实 DSH 版本为 `0.2.2-alpha.2`。

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| 独立自动验收 | 40 个行为点中，30 个通过、10 个失败；Node 额外计入父测试容器后显示 41 项、11 项失败。失败来自活动目录保留、首个优化继续执行和结果交付等行为断言。 | [原始报告](evidence/13-infra-duplicate-baseline.txt)、[结构化记录](evidence/13-infra-duplicate-baseline.json) |
| 真实 DSH 单次正常调用 | 33 项检查全部通过，真实子会话通过实际 bash 工具写入修改和交接说明，Host 随后提交优化、执行批次并交付结果。 | [正常对照记录](evidence/13-real-dsh-normal.json) |
| 真实 DSH 重复调用 | 36 项观测检查全部通过，确认活动工作目录被删除、两次调用最终失败以及状态未结束。此处通过表示成功复现缺陷。 | [缺陷复现记录](evidence/13-real-dsh-duplicate.json) |

扩展自动基线另外覆盖优化完成后实际 runner 仍运行时重复调用，以及通过已注册 `aleph_run_batch` 绕过活动优化的路径。该基线实际执行 61 个行为点，45 个通过、16 个失败；Node 计入父测试容器后为 62 项、17 项失败。新增失败确认额外优化代理仍会启动，直接运行工具也会提前执行计算。报告见[扩展基线](evidence/13-infra-duplicate-expanded-baseline.txt)与[结构化记录](evidence/13-infra-duplicate-expanded-baseline.json)。

扩展夹具在确认直接运行工具已经错误启动计算后，先放行该次计算完成，再拒绝仍在受控等待的测试激活以结束场景；该收尾不计作产品行为。直接运行工具正确拒绝时，夹具另外执行 4 个首流程正常交付断言，因此修复验收共执行 65 个行为点。首次扩展执行因原流程在 `finally` 异步清理期间产生暂未处理的拒绝而中止，[原始中止报告](evidence/13-infra-fixture-premature-direct-abort.txt)与[不完整结构化记录](evidence/13-infra-fixture-premature-direct-abort.json)单独保留，不使用其不完整计数代替上述完整基线。

自动验收使用实际 `ProjectService`、Git 仓库与 runner，项目存储使用内存适配器；仅将代理激活和结果等待替换为可控制的确定性适配器。测试覆盖单次正常运行、活动代理期间的重复调用、已完成批次重复调用、无效输入，以及代理启动失败后的合法重试。

真实 DSH 场景使用实际父会话、子会话、原始子代理提供程序、工具注册、持久存储、Git 与 runner。本地 `LlmAdapter` 只预定模型输出和等待时机，不连接外部模型；真实 InfraOptimizer 子会话通过实际 bash 工具写入优化文件，随后在受控等待期间接收另一真实父会话的重复请求。子会话持久记录证明其来源为 `subagent`、配置为 `aleph-infra`，且关联首个父会话。该场景证明实际 DSH 会话与工具路径下的问题，不表示外部模型自主完成优化。

复现命令在 `aleph-tests` 工作区执行：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_INFRA_OBSERVATIONS=/home/paulus-chang/项目/aleph-tests/tests/issues/evidence/13-infra-duplicate-baseline.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/infra-duplicate-acceptance.test.mjs

python3 tests/issues/dsh/current-infra-duplicate.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/13-real-dsh-normal.json

python3 tests/issues/dsh/current-infra-duplicate.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/13-real-dsh-duplicate.json \
  --duplicate
```

脚本包括[自动验收](dsh/infra-duplicate-acceptance.test.mjs)、[真实 DSH 场景](dsh/current-infra-duplicate.py)与[确定性模型适配器](dsh/infra-deterministic-bridge.mjs)。每份最终记录保存执行命令、源码版本与替代范围，场景结束后均已停止隔离服务。

准备期间曾遇到本地适配器遗漏 bash 必填描述字段，以及通用诊断接口没有提供预期事件数组的问题。相关[参数错误记录](evidence/13-dsh-fixture-invalid-bash-arguments.json)和[事件接口假设记录](evidence/13-dsh-fixture-session-events-assumption.json)单独保留；夹具修正后重新完成上述场景，准备错误没有作为产品缺陷证据。

源码位置如下：

- [批次创建与初始状态](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L661)：机器被占用，批次状态设为 `forming`。
- [优化入口检查和目录删除](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L580)：入口只检查 `forming`，随后删除固定批次目录。
- [真实优化代理启动与等待](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L605)：Host 登记代理后等待结果，批次没有取得独占执行权。
- [优化完成后执行批次](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L625)：正常路径由 `runInfra` 继续调用 `runBatch`。

## 与现有议题的区别

[ALEPH-01](01-run-next-concurrency.md) 与上游 [#3](https://github.com/hapenia/aleph-research/issues/3) 讨论旧版不同研究任务绕过并发上限。本议题讨论当前版本中同一批次缺少重复启动保护，直接后果是活动工作目录被删除。

[ALEPH-05](05-restart-recovery.md) 与上游 [#6](https://github.com/hapenia/aleph-research/issues/6) 讨论主进程异常退出后的恢复、孤立计算和重试现场保留。本议题限定 DSH 没有重启、首个真实 InfraOptimizer 仍活动时收到重复请求。修复可能共用执行预约或目录保护机制，但无重启的活动执行保护需要独立验收。

## 验收条件

1. 首次优化启动后，状态能够区分尚未启动的批次和已经取得执行权的批次。
2. 同一批次的重复请求在删除、替换或修改活动目录之前被拒绝，或返回已有执行记录。
3. 第二次请求不启动额外优化代理，不改变首个代理的文件，也不导致首个代理失败。
4. 首个优化代理能够正常完成修改和交接，Host 能继续执行批次并交付结果。
5. 实际批次运行阶段也保持同一批次的独占执行，重复请求不会删除正在运行的目录。
6. 首次启动失败时能够释放本轮预约或记录明确失败，后续合法重试不会破坏仍在运行的任务。
7. 单次正常调用、已完成批次的重复调用，以及不同批次的合法操作均得到明确且一致的处理。

## 公开证据

议题文档、复跑脚本与验收记录已经发布到派生仓库的独立证据分支 `evidence/2026-10-31-validation`，固定提交为 `23f4c0f67f78c39639c9d3a877b337e3907b7499`，入口见[公开证据目录](https://github.com/PaulusPliniusChang/aleph-research/tree/23f4c0f67f78c39639c9d3a877b337e3907b7499/tests/issues)。该分支以当前 `main` 为基础，仅加入已经提交的 `tests/issues` 文件，没有加入旧测试分支的产品实现或用户未提交测试改动。本地管理字段和注释保持，GitHub 议题正文不包含管理头和前导注释。
