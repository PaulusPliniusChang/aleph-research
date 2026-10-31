---
id: ALEPH-14
status: dsh实测有问题
type: 缺陷
remote_issue: null
pull_request: null
---

<!-- 本地管理说明：用户于 2026-10-31 授权先同步远端，候选仍存在时登记为可疑。B 已完成最新源码适用性复核；主代理因 A 的任务消息正文传递异常代为登记。GitHub 正文应移除管理头及本段前导注释，本地文件保留完整内容。 -->

# 一个研究代理结束时，可能批量改写其他研究代理的状态与摘要

## 当前情况

同一项目可以启动多个研究代理，每次激活都有独立的 `childId`。Host 会分别保存研究代理的运行记录，但成功和失败回调只按“角色为 researcher 且状态为 running”选择待更新记录，没有匹配本次结束代理的 `childId`。

因此，在同一项目的多个研究代理重叠运行时，一个代理结束可能把其他仍在工作的代理也标为完成或失败，并把同一份摘要写入多份记录。建议优先级为 P2。

B 已执行 50 个有意义的自动行为测试点，其中 38 个通过、12 个失败；失败来自本议题对应的状态与摘要归属断言。Node 额外计入父测试容器后报告 51 项、38 项通过和 13 项失败。实际 DSH 的 31 项观察检查全部通过，表示缺陷复现成功，尚未发布远端议题。

## 使用例子

项目同时启动“检查数据处理”和“研究训练参数”的研究代理。数据处理代理先完成，训练参数代理仍在工作。

预期结果是数据处理代理显示为完成并保存数据处理摘要，训练参数代理继续显示为运行中。当前回调却可能把数据处理和训练参数的记录都改为完成，并把数据处理摘要也写入训练参数代理的记录。

训练参数代理随后真正结束时，原记录已经不再是运行中，后续回调可能无法补回训练参数摘要。数据处理代理先失败时，也存在把其他运行记录一起改为失败的风险。

## 触发条件与影响范围

触发前提是同一项目存在运行时间重叠的研究代理。只有一个运行中的研究代理时，不满足本议题所描述的批量误更新条件。

影响范围是代理状态和摘要归属错误。Leader 查询状态时可能误以为研究已经结束，或者读取到另一项研究的结论。当前源码证据不能证明其他子会话因此停止，也不能证明计算任务被取消；后续实测应分别观察运行记录和真实子会话。

## 最新远端复核与源码证据

B 于 `2026-10-31T08:13:45Z` 串行完成上游和派生仓库的远端获取，并在干净主工作区执行 `git pull --ff-only origin main`。上游默认分支为 `main`，本地、上游和派生仓库的主分支均为 `66885994ceadad83a237a27c1fc7de6419889c14`，本次没有发现更新的上游提交。

- [研究代理启动入口](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L507)没有按项目和 researcher 角色限制为单个活动代理；方法登记回调后直接返回，不等待研究代理结束。
- [独立激活记录](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L532)分别保存每次激活的 `childId`。
- [成功回调](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L535)及[失败回调](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L537)只按角色和运行状态选择记录，没有按本次激活编号匹配。
- [注册工具入口](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L806)检查调用者的 Leader 身份，没有增加 researcher 单实例限制。

B 还检查了当前安装的 DSH `0.2.2-alpha.2` 源码：子代理启动为每次未指定编号的激活分配独立编号，默认活动子代理容量为 8，没有按项目、角色或相同工作目录进行单实例去重。该检查支持重叠激活的源码前提，不能代替真实启动场景。

该回调形式由提交 `7d51e61fe8933a8a2e7ebda7ffa6bf23bf63381e` 引入。B 在本次复核中检查了上游现有议题和拉取请求，没有发现专门修复 researcher 回调归属的现有条目。自动测试证据见下节；实际 DSH 操作与证据见下节。

## 自动验证（2026-10-31）

测试前，B 于 `2026-10-31T08:22:58Z` 再次串行完成上游与派生仓库更新获取，并对干净主工作区仅快进拉取。被测提交仍为 `66885994ceadad83a237a27c1fc7de6419889c14`。

[自动验收脚本](dsh/researcher-ownership-acceptance.test.mjs)通过插件实际注册的工具函数创建项目、启动研究代理和查询状态。插件回调、状态更新与项目 Git 初始化保持真实；测试使用内存存储、调用会话适配器及可控制结果的激活替身。历史结束记录和其他角色记录为明确加入的对照数据。该自动测试不能证明实际 DSH 子会话的运行状态。

测试分别让先启动的研究代理成功或失败，同时保持后续代理结果未完成。当前代码把未结束代理改为相同终态，并覆盖摘要。后续代理实际返回相反结果与独立摘要时，错误记录没有得到补回。单代理成功、失败、启动失败，以及历史记录、其他角色和其他项目隔离对照均通过。

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_RESEARCHER_OBSERVATIONS=tests/issues/evidence/14-researcher-ownership-baseline.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/researcher-ownership-acceptance.test.mjs
```

结果见[原始报告](evidence/14-researcher-ownership-baseline.txt)和[结构化观察](evidence/14-researcher-ownership-baseline.json)。自动失败没有使用预期失败标记，测试执行没有依赖缺失或夹具中断。实际 DSH 的独立范围见下节；自动激活替身的失败回调验证不能等同于实际 DSH 激活清理失败。

## 实际 DSH 核查（2026-10-31）

被测版本仍为 `66885994ceadad83a237a27c1fc7de6419889c14`，产品受版本管理的文件没有本地改动。实际 DSH 版本为 `0.2.2-alpha.2`，使用隔离状态目录、真实父子会话、原始 spawn 提供程序、实际注册工具、持久项目存储与 Git。

[本地确定性模型适配器](dsh/researcher-deterministic-bridge.mjs)只预定模型响应与各子会话的等待时机，不替换代理启动服务，也不连接外部模型。真实 researcher 子会话分别通过实际 bash 工具在研究仓库写入工作目录标记，然后独立等待。实际会话头记录来源为 `subagent`、预设为 `aleph-researcher`，并关联真实父会话；持久子会话目录分别包含独立编号。

1. 调用实际 `aleph_init_project`，再通过同一真实 Leader 父会话连续调用 `aleph_run_researcher`。
2. 等待实际子会话分别完成 bash 标记写入，并在下一轮模型输出中保持等待。此时实际项目记录均为 `running`，摘要为空。
3. 只释放首个子会话。首个结果落入项目后，后续子会话仍为实际活动代理，模型等待尚未释放，也没有输出最终摘要；项目记录却已经把后续代理标为 `done`，摘要等于首个代理结果。实际注册的 `aleph_status` 返回同样的错误记录。
4. 释放后续子会话，确认其实际输出独立摘要并结束等待。最终持久记录仍保留首个摘要，没有保存后续代理的真实结果。

[真实 DSH 脚本](dsh/current-researcher-ownership.py)共执行 31 项观察检查，全部通过，表示缺陷已经复现。该场景实测成功回调的重叠路径；失败回调的归属问题由前述自动测试证实，没有据此宣称实际 DSH 激活清理失败已经复现。其他角色的合法重叠仍需分别核查。隔离 DSH 已停止，记录确认进程不存在。

```bash
python3 tests/issues/dsh/current-researcher-ownership.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/14-current-real-dsh-researcher-ownership.json
```

原始观察、实际会话头、子会话目录、等待状态、公开项目响应、执行命令和清理结果保存在[实际 DSH 记录](evidence/14-current-real-dsh-researcher-ownership.json)。本次没有观察到其他子会话因此停止；相反，实际活动状态与错误项目终态同时存在。

## 与现有议题的区别

- [ALEPH-05](05-restart-recovery.md)讨论 DSH 重启后的恢复，本议题无需重启即可触发。
- [ALEPH-10](10-mission-reports.md)讨论实验报告与反馈，本议题讨论已经存在的代理状态及摘要被错误写给其他代理。
- [ALEPH-13](13-infra-duplicate-start.md)讨论同一批次重复启动优化时破坏工作目录，本议题使用不同研究任务的合法重叠运行，不依赖重复启动同一批次。

Composer 和 InfraOptimizer 的回调存在相近的按角色更新形式，但各角色的合法重叠前提需要分别核查，当前不直接扩大已确认的影响范围。

## 预期行为与验收条件

1. 同一项目启动具有不同激活编号、不同结束时间和不同摘要的研究代理时，每次结果只更新对应激活记录。
2. 一个研究代理成功后，其他仍在工作的代理继续保持运行状态，摘要保持原值。
3. 一个研究代理失败后，其他运行代理不会被误标为失败，也不会收到其他代理的失败原因。
4. 其他代理随后成功或失败时，能够分别保存对应的最终状态和摘要。
5. 其他项目、其他角色和历史已结束记录不受本次回调影响。
6. 单代理正常成功、失败和启动失败行为保持正确；Composer 与 InfraOptimizer 的相近回调也应按实际合法场景核查。
7. B 构建至少 30 个有意义的自动测试点，记录命令、版本、替代范围及实际行为，并在真实 DSH 环境分别核查状态查询和子会话状态。
