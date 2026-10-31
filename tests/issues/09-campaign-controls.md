---
id: ALEPH-09
status: dsh实测有问题
type: 功能缺项
remote_issue: https://github.com/hapenia/aleph-research/issues/10
pull_request: null
---

# 研究过程缺少暂停、恢复、取消和结束操作

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
