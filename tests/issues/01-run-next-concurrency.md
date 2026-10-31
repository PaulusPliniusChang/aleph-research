---
id: ALEPH-01
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/3
pull_request: https://github.com/hapenia/aleph-research/pull/30
---

# 单任务派发可以绕过并发上限


## 当前整合交付

[PR #30](https://github.com/hapenia/aleph-research/pull/30) 将 PR #26 的项目控制与 PR #29 的重启后持续收尾整合，当前开放且尚未合并。准确提交为 `a85ccea4a6e7da7f2c56708627cbd1a873b7493a`。组合已经通过产品 262 项、B 独立 105 个有效自动行为点及实际 DSH 105 个有效观察点，范围与证据见[组合验收](09-campaign-controls.md#项目控制与重启恢复的组合验收2026-10-31)。PR #26 和 PR #29 保留为分别验收的历史请求；此次整合没有扩大多机器范围，也没有改变原人工状态。


## 最新主分支正式核查与现有修复验收（2026-10-31）

本次正式核查以最新主分支 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 为准。B 在验收前依次同步上游与派生仓库，并以仅快进方式确认本地主分支保持最新。旧[拉取请求 #17](https://github.com/hapenia/aleph-research/pull/17) 已关闭且未合并，旧修复验收仅作历史记录。上游保留的多机器需求与本次单台机器的并发保护分别记录。

当前主分支仍能在重叠的 `aleph_form_batch` 调用中重复分配同一台机器。真实任务在2 个独立批次工作目录中同时执行，机器和任务的持久归属被后续编排覆盖。现行结果交付已经包含 Git 引用检查：首个批次交付成功后，重复批次的交付明确失败，先前报告提交得以保留。该保护避免报告被覆盖，但重复计算已经发生。

现有[拉取请求 #26](https://github.com/hapenia/aleph-research/pull/26) 的产品提交 `b1f9f048ae8cc7569e6a9e36dcafe119f2c02783` 已经包含项目操作互斥。本次直接验收该提交，没有新增产品修改。并发的后续请求在改动 Git 或归属前被拒绝，实际只形成并运行一个批次；顺序拒绝、计算期间拒绝、成功与失败后的释放以及再次使用机器均正常。

| 验证对象 | 自动行为检查 | 实际 DSH 核查 |
| --- | --- | --- |
| 当前主分支 | 54 个有效行为点中 49 个通过、5 个保护断言失败；含父测试容器的 Node 报告为 55 项。 | 66 项缺陷观察全部通过，表示重复分配与实际重复计算已经复现。 |
| PR26 的现有提交 | 54 个有效行为点全部通过；含父测试容器的 Node 报告为 55 项全部通过。 | 59 项保护观察全部通过，实际只有一个批次运行，归属保持正确。 |

自动核查调用真实服务、Git、批次运行器和 shell 任务，通过磁盘适配器替代宿主持久存储。实际核查运行已安装的 DSH `0.2.2-alpha.2`，使用真实注册工具、持久存储、Git 与实际任务，不调用模型。透明 Git 调度脚本只控制后续请求初次读取模板的时机，用于稳定安排已经重叠的公共调用，不能用于估算自然发生频率。该结论限于一个 Host 内的同一项目，不证明跨 Host 或多台机器调度的完整契约。

自动证据见[当前基线报告](evidence/01-latest-machine-capacity.txt)、[基线结构化记录](evidence/01-latest-machine-capacity.json)、[PR26 报告](evidence/01-latest-pr26-capacity.txt)和[PR26 结构化记录](evidence/01-latest-pr26-capacity.json)。实际证据见[当前基线记录](evidence/01-latest-real-dsh-capacity.json)和[PR26 保护记录](evidence/01-latest-pr26-real-dsh-capacity.json)，对应[实际核查脚本](dsh/latest-machine-capacity.py)与[自动核查脚本](dsh/machine-capacity-acceptance.test.mjs)。隔离 Host 的进程编号分别为 `485635` 与 `487286`，正常退出后均已确认不存在。

本次实际夹具原先沿用了“重复执行全部交付成功”与“所有 Git 命令均返回零”的旧假设，现行引用保护使这些假设不成立。相关[终态假设中断](evidence/01-latest-real-dsh-terminal-contract-fixture-attempt.json)与[Git 返回值假设中断](evidence/01-latest-real-dsh-git-contract-fixture-attempt.json)均单独保留，正式核查明确要求重复报告被引用检查拒绝，并确认没有其他 Git 失败。PR26 自动夹具首次缺少 `zod`，未进入行为检查；[原始依赖中断报告](evidence/01-latest-pr26-dependency-fixture-attempt.txt)单独保留。临时依赖链接已经移除，产品提交没有变化。

PR26 尚未合并，本地状态保留 `dsh实测有问题`，上游议题 #3 保持开放。PR26 与重启修复 PR29 的组合尚未独立验收，本节不将单独通过的结果扩展到组合版本。

复现命令如下；检验 PR26 时，将自动命令的源码目录切换为该工作树，并为实际命令加上 `--expect-protection`。

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_CAPACITY_OBSERVATIONS=tests/issues/evidence/01-latest-machine-capacity.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/machine-capacity-acceptance.test.mjs

python3 tests/issues/dsh/latest-machine-capacity.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/01-latest-real-dsh-capacity.json
```

## 当前并发修复与独立验收（2026-10-31）

修复已通过独立自动验收和实际 DSH 核查，并已提交上游[拉取请求 #17](https://github.com/hapenia/aleph-research/pull/17)。该请求仍未合并；本地管理状态保留已有缺陷实测记录，没有代替用户设置“已解决”。修复证据固定于[公开提交 `e641dc8b41956aeb95a1a27fdf189d0cf6121480`](https://github.com/PaulusPliniusChang/aleph-research/tree/e641dc8b41956aeb95a1a27fdf189d0cf6121480/tests/issues)。

修复提交为 `06c4d3d709f8125260162b032b1631bb4bd64187`，派生仓库分支为 `fix/aleph-01-machine-capacity`。B 在正式工作树中导入 C 冻结的产品和行为测试文件，提交内容与[冻结内容摘要](evidence/01-fixed-frozen-content.json)一致。提交前最后一次同步于北京时间 `2026-10-31T17:05:53+08:00` 完成，上游主分支仍为 `66885994ceadad83a237a27c1fc7de6419889c14`。

修复按任务仓库的真实路径串行执行机器检查、任务选择、Git 编排和持久化。请求获得互斥权后重新读取状态，最终写入前再次校验机器和任务归属；Git 使用已捕获的任务提交。失败时恢复模板检出并删除尚未发布的临时分支，已经被持久批次引用的分支予以保留。

| 验证范围 | 结果 | 证据 |
| --- | --- | --- |
| 产品自动测试 | 87 项全部通过，无跳过；新增编排测试包含 85 个有意义的子行为检查点。 | [产品报告](evidence/01-fixed-product.txt) |
| B 独立自动验收 | 54 个行为点全部通过；Node 包含父测试容器为 55 项全部通过。 | [报告](evidence/01-fixed-machine-capacity.txt)、[结构化记录](evidence/01-fixed-machine-capacity.json) |
| 实际 DSH 修复核查 | 58 项检查全部通过，确认容量保护有效。 | [实际记录](evidence/01-fixed-real-dsh-machine-capacity.json) |

实际 DSH 使用原始注册工具、持久存储、Git 和真实 shell 任务，不调用模型。首个编排调用进入真实 Git 后，后续公共调用与首个调用重叠，最终仅保留首个批次，后续调用明确拒绝机器忙碌。机器及任务归属保持，实际计算只启动一次；正常任务成功、失败后的释放及再次编排均通过。隔离 Host 已正常退出，B 另行确认其进程编号已不存在。

独立验收允许正确的提前预约或等待互斥方案，不再要求后续调用开始前机器必须仍为空闲；原缺陷基线和原始失败记录保留。新工作树首次启动产品测试时缺少 `zod`，该次没有执行行为测试；[依赖中断原报告](evidence/01-fixed-product-dependency-attempt.txt)单独保留。B 复用主目录现有依赖后执行正式产品测试，没有修改冻结产品内容，也没有将依赖中断计作产品缺陷。

在正式产品工作树的 `dsh-plugin` 目录执行 `npm test`。在 `aleph-tests` 根目录执行独立验收：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph-fix-capacity \
ALEPH_CAPACITY_OBSERVATIONS=tests/issues/evidence/01-fixed-machine-capacity.json \
node --experimental-loader /home/paulus-chang/项目/aleph-fix-capacity/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/machine-capacity-acceptance.test.mjs

python3 tests/issues/dsh/current-machine-capacity.py \
  --source /home/paulus-chang/项目/aleph-fix-capacity \
  --output tests/issues/evidence/01-fixed-real-dsh-machine-capacity.json \
  --expect-protection
```

互斥边界是同一进程、同一加载模块内的任务仓库，覆盖多个服务实例与符号链接别名，不提供跨独立 Host 进程的保证。该修复仅涉及批次编排，不包含或替代重启恢复 PR #13 和重复优化 PR #15。

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

两次并发编排均成功，持久记录包含同一台 `local` 机器上的2 个 `forming` 批次，后续请求覆盖机器和任务归属。真实任务同时运行于不同批次工作目录；全部 Git 命令返回零，没有 Git 锁冲突或测试脚本异常。该调度用于稳定复现已经进入公共接口的并发请求，不用于推算自然发生概率。

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

1. 设置 `ALEPH_MAX_PARALLEL=1`，创建研究活动并排队 2 个任务。
2. 调用 `aleph_run_next`，保持首个任务运行。
3. 再次调用 `aleph_run_next`，查询 `aleph_status`。

## 实际结果

后续研究代理成功启动。状态返回 `max_parallel: 1`、`active_agents: 2`、`counts.running: 2`。

## 预期结果

容量已满时拒绝派发，剩余任务保持排队；任务完成并释放容量后才允许继续派发。并发检查与派发预约应保持一致，避免同时调用时突破上限。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认，真实研究子会话已发起模型请求并调用工具。证据见 [并发实测记录](evidence/01-real-dsh-concurrency.json)。被测版本、自动测试命令和复现脚本见 [验证记录](VALIDATION-2026-10-31.md)。
