---
id: ALEPH-09
status: dsh实测有问题
type: 功能缺项
remote_issue: https://github.com/hapenia/aleph-research/issues/10
pull_request: https://github.com/hapenia/aleph-research/pull/26
---

# 研究过程缺少暂停、恢复、取消和结束操作


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


## 当前修复验收

上游拉取请求为 [PR #26](https://github.com/hapenia/aleph-research/pull/26)，尚未合并。修复提交为 `b1f9f048ae8cc7569e6a9e36dcafe119f2c02783`，派生分支为 `fix/aleph-09-project-controls`，基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。修复提供 Leader 正式工具及经过 DSH 外层登录认证的 HTTP 操作：项目暂停、恢复、结束，排队任务取消，以及整批运行取消。暂停阻止新派发，已有计算继续执行；结束关闭派发并等待已接纳工作完成；取消确认实际停止后才释放机器，保留工作树、原任务分支及诊断。尚不能确认停止时，操作保持 `complete:false`、取消中及机器占用状态。

批次执行权在目录操作之前取得，因此同一修复同时覆盖原议题 #14 的 InfraOptimizer 准备窗口。该窗口尚未启动优化模型；后续独立阶段另外启动真实优化模型、通过 Bash 写入文件并验证取消后文件保留，准备与活动阶段的证据分别记录。

| 验证范围 | 结果与证据 |
| --- | --- |
| 产品自动测试 | Node 167/167 通过，包含 144 个新增有效行为点、16 个新增容器及 7 个既有测试。见[产品输出](evidence/09-fixed-product-unicode-corrected.txt)。 |
| B 独立自动验收 | 75 个有效行为点全部通过，Node 连同父容器为 76/76。见[行为记录](evidence/09-fixed-controls-independent.json)及[执行输出](evidence/09-fixed-controls-independent.txt)。 |
| 实际 DSH | 77 个有效行为观察全部通过，Node 连同父容器为 78/78。见[完整记录](evidence/09-fixed-real-dsh-controls.json)及[执行输出](evidence/09-fixed-real-dsh-controls.txt)。 |
| 实际 Host 重启 | 上述实际记录另含 12 项持久化检查，项目结束状态、任务状态与结果提交、机器状态及批次归属全部保持。 |

独立自动模式替代 DSH 存储、会话、预设和激活回执，保留真实 Git、工作树、Python 主子进程、进程组及信号。实际模式使用已安装 DSH 的真实父子会话、注册工具、存储、激活回执和 Python 计算；确定性本地模型只控制模型返回。真实 Composer 调用 `aleph_run_batch`，批次运行期间接受结束请求，计算正常交付成果，随后激活回执释放完成。该流程检查了当前工具尚未返回时请求释放 Composer 的等待问题。

实际 InfraOptimizer 使用 Bash 写入 `infra-fixture-marker.txt`，取消操作释放对应激活回执，工作树及修改保留。实际计算取消场景记录 Python 入口与普通子进程身份，确认入口与子进程均停止后才返回完成，并验证机器释放及没有虚构结果提交。准备窗口继续使用真实 Git 创建工作树后延迟响应的调度器；重复请求没有再次执行 Git 创建，也没有删除首目录、改变目录 inode 或移除标记。

此次实际隔离配置明确设置 Composer 的 `tool-subagent` 后端为 `spawn`。安装环境要求该配置；原预设缺少该值，因此旧基线中的 Composer 未启动。该配置调整仅用于隔离运行环境，产品 JavaScript、执行期限、激活服务及释放服务均保持原始实现。全局默认模型使用本地适配器。此前错误添加预设默认模型导致重复服务注册的记录保存在[配置准备失败记录](evidence/09-fixed-real-dsh-controls-provider-fixture-attempt.json)及[输出](evidence/09-fixed-real-dsh-controls-provider-fixture-attempt.txt)，不属于产品失败。

自动夹具的会话对象参数错误记录保存在 `09-fixed-controls-session-fixture-attempt.*`。首次产品测试使用 URL 的 `pathname`，中文仓库路径被百分号编码，导致测试启动器无法加载；该次输出保存在[原始失败日志](evidence/09-fixed-product.txt)。C 仅将测试路径转换改为 `fileURLToPath`；B 导入唯一变化后重跑完整产品测试，167/167 通过。运行时代码没有因此改变。[冻结清单](evidence/09-fixed-source-manifest.json)记录全部产品文件摘要，提交前逐项核对一致，临时依赖链接已移除。

实际 Host `388560` 在重启前退出，最终 Host `388940` 正常退出，对应进程编号均不存在。当前独立实际场景覆盖排队取消、正在计算的取消、结束等待、Composer 回执释放、InfraOptimizer 准备竞争与活动取消，以及终态重启。依赖准备取消、结果发布与取消竞争、不确定释放及启动回执恢复边界由产品自动测试覆盖，本轮没有逐项重复为真实 DSH 场景。

支持边界是单个 Host、Linux、可读取的 `/proc` 以及保留在所属进程组中的普通后代进程。主动脱离进程组的进程、远端计算及跨 Host 竞争不在本轮保证范围。操作页面按钮不属于本次实现。原人工维护状态按规则保留；上游合并情况另行记录。

复跑使用[独立脚本](dsh/fixed-project-controls.test.mjs)、[实际启动脚本](dsh/fixed-project-controls.py)及[模型适配器](dsh/controls-deterministic-bridge.mjs)。自动模式需设置 `ALEPH_CURRENT_SOURCE`、`ALEPH_FIXED_CONTROLS_OUTPUT`、`ALEPH_INFRA_PREPARATION_GATE`，并将临时 `bin/git` 链接至[精确 Git 调度器](dsh/infra-preparation-git-scheduler.py)。实际命令如下：

```bash
python3 tests/issues/dsh/fixed-project-controls.py --source /home/paulus-chang/项目/aleph-fix-project-controls --output tests/issues/evidence/09-fixed-real-dsh-controls.json
```

## 当前版本适用性复核（2026-10-31）

当前正式核查版本为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`，插件入口为 `dsh-plugin/index-v2.js`，采用 project、mission 和 batch 模型。旧版范围是 campaign 的暂停、恢复、取消和结束。当前顶层模型为 project，旧活动控制验收条件不能直接套用；项目、任务、批次的控制需求需要分别确认。

B 已完成当前实现的 47 个有效自动行为检查点及真实 DSH 核查，并完成 Host 重启后的成果查询对照。项目、排队任务和运行批次仍缺正式控制操作。旧 campaign 验收记录保留为历史，当前结论以下述 project、mission 和 batch 流程为准。远端继续维护原议题 #10，不创建重复议题。

## 问题

Aleph 有创建活动和启动任务的工具，但缺少暂停、恢复、取消排队任务、终止运行任务和结束活动的正式操作，用户无法直接控制研究过程。

## 复现

1. 在 DSH 中创建 Aleph 活动，启动任务并保留排队任务。
2. 查看该会话可用的 Aleph 工具及参数。
3. 检查暂停、恢复、取消、终止和结束操作是否可用。

## 实际结果

实际工具目录只有创建、状态、排队、批次创建、派发、资源查询与参数设置，没有上述控制操作。

## 预期结果

暂停后不再派发，恢复后可以继续；排队任务可以取消，运行任务可以终止并处理工作目录；活动结束后停止派发，已有成果仍可查询。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测检查了真实会话的工具注册表。证据见 [工具目录](evidence/09-11-real-dsh-tools.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。结论限于 Aleph 正式控制工具；进程重启后的恢复由 [ALEPH-05](05-restart-recovery.md) 处理。


## 最新架构正式核查

B 于北京时间 `2026-10-31T19:28:33+08:00` 串行获取上游和派生仓库，并对干净主分支执行仅快进同步；主分支仍为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。当前研究采用 project、mission 和 batch，不恢复旧 campaign 模型。

当前需要补齐的操作是项目暂停、恢复与结束，排队任务取消，以及运行批次的明确取消。暂停应阻止新派发，已有计算继续收尾；结束应关闭新派发并保留已有成果；单个任务取消针对尚未进入批次的 proposed 或 approved 任务；运行工作应通过批次取消处理。该语义已经由用户授权采用。

### 自动检查

```bash
ALEPH_CONTROLS_OBSERVATIONS=tests/issues/evidence/09-current-controls-baseline.json node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs --test tests/issues/dsh/project-controls-acceptance.test.mjs
```

[自动脚本](dsh/project-controls-acceptance.test.mjs)执行实际插件注册函数及真实 Git、Python 任务；自动模式以明确适配器替代 DSH 存储、会话、预设和等待中的 Composer。47 个有效行为检查点中，37 个通过，10 个失败；Node 连同父测试容器报告 48 项、37 项通过、11 项失败。失败分别对应正式控制工具及 HTTP 操作的缺失。完整注册目录和路由清单已记录，正常提案、审批、编排、执行、结果交付、产物查询及机器释放均有行为对照。

自动 JSON 中的 `defect_reproduced` 字段原先直接取自实际模式开关，因此自动模式记录为 `false`；该字段不表示自动检查没有发现问题。自动结论来自 10 项缺项断言失败，准确分类另见[证据说明](evidence/09-current-controls-classification.json)。原始文件保留。

自动结果见[原始输出](evidence/09-current-controls-baseline.txt)和[完整行为记录](evidence/09-current-controls-baseline.json)。各检查分别对应操作入口、状态变化、实际执行或成果保留。

### 实际 DSH

```bash
python3 tests/issues/dsh/current-project-controls.py --source /home/paulus-chang/项目/aleph --output tests/issues/evidence/09-current-real-dsh-controls.json
```

[实际启动脚本](dsh/current-project-controls.py)加载原始 DSH 和干净产品源码。真实父会话、工具可见性、持久化存储、Git 工作树及 Python 计算均由实际环境提供；隔离配置准备了本地确定性模型，但该次 Composer 启动因 `$.provider: missing required value` 失败；本轮任务审批后的编排和执行由脚本直接调用真实工具完成，没有验证 Composer 的自动派发。脚本没有改写产品源码，也没有向项目注入暂停或取消状态。

47 项实际观察全部符合缺项复现条件。Leader 可见的完整工具定义没有相应控制操作；脚本通过 DSH 正常登录流程取得会话认证后，请求项目暂停、恢复、结束、任务取消和批次取消路径，均得到 `404 not found`。脚本不会公开隔离环境的登录凭据。

排队任务取消调用明确返回 `missing tool`，任务仍为 proposed；正常审批后，暂停和结束调用同样失败，任务继续形成批次。实际 Python 任务运行期间，批次取消调用失败，计算进程继续存在。测试随后释放专用门闩，正常计算完成并交付 `artifact.txt`，结果提交可以读取，机器恢复空闲且清除批次归属。这些正常行为不能替代缺失的控制操作。

脚本随后真实停止并重启 Host，新增 8 项持久性观察全部通过：项目身份、已完成任务和批次、结果提交、产物内容及机器空闲状态保持。当前没有暂停或取消操作，因此本轮不能验证尚不存在的控制意图持久性。运行取消的精确进程终止、迟到回调保护和控制竞争仍须在修复验收中验证。

完整证据见[实际 DSH 记录](evidence/09-current-real-dsh-controls.json)及[执行输出](evidence/09-current-real-dsh-controls.txt)。重启前 Host 进程 `312008` 已退出，最终 Host 进程 `312428` 也已退出，进程编号均不存在。最初未认证的控制路径请求返回 `401`，该环境准备尝试单独保存在 `09-current-real-dsh-controls-route-fallback-attempt.*` 和 `09-current-real-dsh-controls-unauthenticated-attempt.*`，没有计为产品缺陷或正式观察结果。
