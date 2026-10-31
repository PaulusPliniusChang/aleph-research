---
id: ALEPH-06
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/7
pull_request: null
---

# 任务记录的代码起点可能与实际起点不一致

当前新增场景已在版本 `66885994` 复现：任务分支在批次形成后推进，结果交付会把分支强制指回旧起点生成的结果提交。新增自动核查包含 83 个有效行为检查点，77 个通过、6 个失败；实际 DSH 的 84 项观察均符合缺陷复现及对照预期。原有编排前变更范围的 76 个自动检查点和 61 项实际 DSH 检查仍然通过，具体范围分别保留在下文。

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `66885994ceadad83a237a27c1fc7de6419889c14`，被测产品没有未提交改动，插件入口为 `dsh-plugin/index-v2.js`。当前实现采用 project、mission 和 batch 模型。提案记录独立 mission 分支，编排批次时记录实际分支提交 `preBatchTip`，结果交付提交以该提交为父节点。

本轮自动验收的 76 个行为测试点全部通过；Node 报告额外计入父测试容器，显示 77/77。真实 DSH `0.2.2-alpha.2` 的 61 项检查全部通过。在已经验证的当前范围内，旧版记录与实际起点不一致的问题没有复现。文件开头的 `status` 保留历史实测结论，不表示当前版本已经复现；上游 [#7](https://github.com/hapenia/aleph-research/issues/7) 保持开放，等待结合本轮适用范围决定后续处理。本轮没有新增产品修复或重复议题。

### 当前实测范围

| 场景与关系 | 结果 |
| --- | --- |
| 单任务分支保持不变；分支在提案后推进；独立任务在审批后推进再组成批次。 | 自动验收全部通过，覆盖未变更的对照与合法的编排前源码变更。 |
| 真实 DSH 中，独立 alpha 任务在提案后推进，beta 任务在审批后推进，然后一起编排并运行。 | alpha 与 beta 均运行最新编排源码，各执行一次，批次结束后机器恢复空闲。 |
| 编排记录、公共快照与真实 Git 历史。 | `preBatchTip` 等于编排时实际任务分支提交，批次提交包含该提交。 |
| 实际运行起点与交付父节点。 | 任务运行组合后的批次提交；各自结果提交以记录的 `preBatchTip` 为父节点，`resultCommit` 等于对应任务分支实际末端提交。 |
| 结果隔离。 | 每个结果提交仅向对应任务起点加入各自的结果信封，保留原任务源码。 |

批次组合提交与单个任务分支起点具有不同用途。当前测试核对组合源码、记录字段和交付父节点的实际关系，不要求任务继承全局最优分支。本轮没有测试批次编排后再修改任务分支的情况，也不覆盖旧版 SOTA 自动继承、优化代理或远程机器。

自动验收使用当前真实 `ProjectService`、Git 合并、runner 和 shell 任务；磁盘 JSON 适配器及模块加载器替代 DSH 存储与工具包依赖。真实 DSH 核查另外通过诊断接口调用实际注册工具，使用真实持久存储、Git 与 runner，不调用模型。隔离宿主已经停止，原始宿主日志不纳入仓库。

### 复跑与证据

在 `aleph-tests` 根目录执行：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_BASE_OBSERVATIONS=tests/issues/evidence/06-current-base-consistency.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/base-consistency-acceptance.test.mjs

python3 tests/issues/dsh/current-base-consistency.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/06-current-real-dsh-base-consistency.json
```

证据包括[自动验收脚本](dsh/base-consistency-acceptance.test.mjs)、[自动报告](evidence/06-current-base-consistency.txt)、[自动结构化记录](evidence/06-current-base-consistency.json)、[真实 DSH 脚本](dsh/current-base-consistency.py)与[真实 DSH 记录](evidence/06-current-real-dsh-base-consistency.json)。完整架构范围见[适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 补充实测场景：结果交付覆盖批次形成后的提交

用户于北京时间 2026 年 10 月 31 日 17:42 明确接纳该场景，A 随后按“可疑”登记。B 已完成自动核查和真实 DSH 复现，议题状态仍以文件开头的 `status` 为准。已有 76 个自动行为测试点和 61 项真实 DSH 检查的通过结论继续有效，这些检查明确不覆盖批次编排后修改任务分支的情况。

### 当前情况与简单例子

Composer 创建批次时保存任务当时的提交 `preBatchTip`。结果交付时，Host 从该旧起点创建结果提交，再强制更新任务分支，没有检查任务分支在批次形成后是否已经产生新提交。建议优先级为 P2。

1. `mission/train` 分支包含训练代码，当前提交为甲。Composer 创建批次，并记录任务起点为甲。
2. 批次形成后、结果交付前，研究代理在同一任务分支提交数据处理修正，产生提交乙，随后切换至其他分支。
3. 批次仍运行甲版本，Host 在甲的基础上生成结果提交丙。
4. Host 强制把 `mission/train` 指向丙，乙退出该任务分支的常规提交历史，乙包含的修正也从分支当前文件中消失。如果其余步骤成功，任务仍可能显示完成。

该场景不要求重复启动批次，也不需要精确的并发时机。批次形成后先产生乙提交并切换离开，再启动批次，同样满足源码所示的条件。

### 源码线索

以下链接固定至本轮被测版本 `66885994ceadad83a237a27c1fc7de6419889c14`。

- [批次形成时记录起点](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L650)：Host 读取任务分支当前提交，并将该提交保存为 `preBatchTip`。
- [结果交付工作目录](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L422)：Host 从 `mission.preBatchTip` 创建独立目录，把结果应用至原任务起点，再取得 `newTip`。
- [强制更新任务分支](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L426)：Host 直接执行 `git branch -f mission.branch newTip`。该步骤没有检查分支是否仍指向 `preBatchTip`，也没有保存、合并或明确拒绝覆盖后续提交。
- [任务终态更新](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L441)：后续状态依据结果信封更新；强制分支更新成功时，没有额外的后续提交覆盖检查。

### 触发条件与证据边界

触发前提是任务分支在批次形成后推进，交付时存在不同于已记录 `preBatchTip` 的后续提交。示例要求该分支已经切换离开；若仍有工作目录检出该分支，Git 可能拒绝 `branch -f`，需要分别验证，不能把不同错误混为同一复现。

当前风险是分支引用和当前文件内容被更新至旧代码加结果，不能直接表述为全部数据永久丢失。Git 可能仍可通过引用日志或提交编号恢复乙，但普通分支历史已经不再包含乙。任务分支始终不变时，不满足该新增场景的条件。

该场景沿用现有上游 [#7](https://github.com/hapenia/aleph-research/issues/7)，不新增议题编号。北京时间 18:01:01，B 依次获取上游和派生仓库更新，并对干净主工作区执行仅快进拉取；本地、上游和派生仓库主分支均保持被测版本 `66885994`。

### 新增自动核查与真实 DSH 结果

自动核查使用当前真实 `ProjectService`、Git 编排及交付、runner 和实际 shell 任务，磁盘 JSON 存储适配器与现有模块加载器替代 DSH 服务依赖。脚本通过文件信号暂停实际任务，以便在计算期间真正提交任务分支修改；没有替换 Git，也没有修改产品源码。

| 场景 | 自动检查与实际 DSH 观察 |
| --- | --- |
| 任务分支保持不变。 | 正常运行和交付，任务与批次完成，结果提交以原任务提交为父节点。 |
| 批次形成后、启动前推进任务分支并切换离开。 | 结果提交以旧起点为父节点；新提交不再属于任务分支祖先，分支文件回到旧代码，任务和批次仍显示完成。 |
| 实际 shell 任务运行期间推进任务分支并切换离开。 | 与启动前推进场景相同，新增修改被静默移出分支历史。 |
| 分支推进后仍保持检出。 | Git 明确拒绝强制更新，任务和批次报告失败，分支仍指向新增提交，修改文件保留。 |

自动核查包含 83 个有效行为检查点，77 个通过、6 个失败。失败分别来自启动前推进及计算中推进场景的新提交祖先关系、分支文件内容，以及保存修改或明确拒绝的行为要求。Node 额外计入失败的父测试容器，报告 84 项检查、77 项通过、7 项失败。没有依赖或测试夹具错误。

真实 DSH 使用 `0.2.2-alpha.2` 的实际注册工具、真实父会话、持久存储、任务 Git 仓库和批次 runner；诊断接口直接调用工具，没有模型请求。84 项观察全部通过，表示缺陷与对照行为均已实际确认，不表示修复通过。新增提交对象仍能按编号读取，证据不能证明全部数据永久丢失。隔离宿主已停止，进程不存在。

在 `aleph-tests` 根目录复跑：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_POST_BATCH_OBSERVATIONS=tests/issues/evidence/06-post-batch-branch-baseline.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/post-batch-branch-acceptance.test.mjs \
  > tests/issues/evidence/06-post-batch-branch-baseline.txt 2>&1

python3 tests/issues/dsh/current-post-batch-branch.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/06-current-real-dsh-post-batch-branch.json
```

证据包括[新增自动脚本](dsh/post-batch-branch-acceptance.test.mjs)、[自动原始报告](evidence/06-post-batch-branch-baseline.txt)、[自动结构化观察](evidence/06-post-batch-branch-baseline.json)、[真实 DSH 脚本](dsh/current-post-batch-branch.py)与[真实 DSH 原始记录](evidence/06-current-real-dsh-post-batch-branch.json)。

### 期望行为与验收条件

1. 任务分支保持不变时，结果仍能正常交付，原有任务起点及结果关联保持正确。
2. 批次形成后产生新提交时，Host 保存已有提交，或明确拒绝不安全的分支更新，并说明当前分支与批次起点的差异。
3. 结果交付不会静默强制覆盖后续提交后仍只报告成功；返回的结果提交、任务分支、当前文件和任务状态之间保持明确关系。
4. 分别覆盖交付前推进、实际计算期间推进、任务分支仍被检出，以及没有分支变化的对照场景，核对新提交的可达性及文件内容。
5. B 构建至少 30 个有意义的自动行为测试点，保存版本、命令、替代范围及原始结果，并通过实际 DSH 注册工具独立核查。既有通过证据不得覆盖，新场景证据应分别保存。

## 旧版历史记录

下述复现、实际结果与证据针对旧 campaign 架构，保留原始结论供追溯。

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

## 本轮公开证据

当前架构核查的文档、脚本与原始记录已经发布到派生仓库的独立证据分支，固定提交为 `a12a2b43e9d14ba623f492b45abfec86ae0148f1`，见[公开目录](https://github.com/PaulusPliniusChang/aleph-research/tree/a12a2b43e9d14ba623f492b45abfec86ae0148f1/tests/issues)。上游 #7 已补充当前结果与固定证据链接，正文不包含本地管理头和前导注释，议题仍然开放。
