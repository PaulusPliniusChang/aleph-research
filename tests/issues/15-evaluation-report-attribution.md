---
id: ALEPH-15
status: dsh实测有问题
type: 缺陷
remote_issue: null
pull_request: null
---

<!-- 本地管理说明：用户于 2026-10-31 17:27 北京时间明确接纳该候选，要求先登记为“可疑”。A 仅登记源码线索；B 应重新同步上游、排重，再执行自动测试和实际 DSH 核查。GitHub 正文应移除管理头及本段前导注释，本地文件保留完整内容。 -->

# 评估期间研究分支发生变化，评分报告可能写入另一条分支

## 当前情况

研究代理提交研究代码后，通过 `aleph_evaluate` 请求评估。Host 从研究仓库当时的 `HEAD` 创建独立评估目录，评估命令在该目录中运行。评估结束后，Host 在共享研究仓库的当前分支提交评分报告，并返回当前提交作为 `researchCommit`。

当前源码没有保存并校验报告对应的原始研究分支和提交。如果评估期间研究仓库切换分支或推进到其他代码，评分报告可能被写入另一份研究代码的提交历史。建议优先级为 P2。

B 已在最新基线 `66885994ceadad83a237a27c1fc7de6419889c14` 完成独立自动测试和实际 DSH 核查，报告与代码关联错误已复现。自动验收包含 59 个有效行为点，其中 54 个通过、5 个失败；实际 DSH 的 56 项观察检查全部通过，表示缺陷复现成功。远端议题和拉取请求链接待补充。

## 使用例子

1. 研究代理甲在 `research/a` 分支提交算法甲，并调用评估工具。Host 创建的独立评估目录包含算法甲。
2. 评估仍在运行，研究代理乙在共享研究仓库中切换至 `research/b` 分支，继续研究算法乙。
3. 算法甲的评估结束，Host 得到算法甲的评分，却在当前的 `research/b` 分支提交报告。
4. 工具返回乙分支上的新提交作为 `researchCommit`。报告包含算法甲的评分，但该提交对应算法乙的研究代码，评分与代码因此可能对应错误。

预期行为是评估报告能够准确关联实际接受评估的代码；研究仓库的当前分支发生变化时，Host 应明确处理变化，不能把原始评分直接归给其他研究代码。

## 触发条件与影响范围

触发前提是共享研究仓库在评估开始至报告提交之间发生分支切换或提交推进。当前研究代理统一从 `project.researchRoot` 启动，提示要求各研究代理维护研究分支；评估命令最长允许运行十分钟，因此其他研究工作可能与评估重叠。

影响范围是评分、报告提交和实际评估代码之间的对应关系可能错误。研究代理或 Leader 后续依据返回的 `researchCommit` 查看代码与评分时，可能作出错误比较。当前证据没有证明研究代码丢失、其他代理停止或计算任务被取消。

研究仓库在整个评估期间保持原提交时，不满足本议题描述的变化条件。单纯存在多个代理也不足以证明问题已经触发，需要观察评估快照与最终报告提交之间的实际关系。

## 源码线索

源码链接固定至 `66885994ceadad83a237a27c1fc7de6419889c14`，不代表最新远端已经复现。

- [评估前置检查](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L467)使用调用代理编号筛选尚未完成的计算任务，但没有据此保存研究分支或评估提交。
- [评估目录创建](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L480)从共享研究仓库当时的 `HEAD` 创建分离状态的工作目录。接受评估的代码在该步骤确定。
- [评估命令执行](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L492)在独立目录中异步运行，最长允许十分钟。
- [报告提交与返回](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L498)清理评估目录后，在 `project.researchRoot` 中执行 `git commit --allow-empty`，再读取共享仓库的 `HEAD` 作为 `researchCommit`。该流程没有检查最终分支及提交是否仍对应原始评估代码。
- [研究代理提示](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L516)要求研究代理维护各自的研究分支；[启动请求](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L526)统一使用 `project.researchRoot` 作为工作目录。
- [公开评估工具](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L799)只接收项目编号，没有研究分支或目标提交参数。
- [当前架构说明](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/docs/architecture.md#L52)要求 Host 评估研究分支，并把报告写入研究提交说明。

## 与已有议题的区别

- [ALEPH-10](10-mission-reports.md)讨论报告查询、反馈及交付完整性。本议题讨论已经生成的评分报告被写给另一份研究代码，不重复要求新增查询接口或 Leader 通知。
- [ALEPH-04](04-sota-promotion-race.md)讨论旧架构中较低评分覆盖最优分支。本议题不依赖最优分支晋升流程。
- [ALEPH-06](06-mission-base-consistency.md)讨论计算任务仓库中的任务起点及结果回传。本议题发生在独立研究仓库的异步评估期间。
- [ALEPH-14](14-researcher-callback-ownership.md)讨论研究代理完成回调误改其他代理的状态和摘要。本议题关注评估快照与报告提交的代码关联，不依赖完成回调。

## 待验证内容与验收条件

1. B 重新同步最新上游，检查远端议题和拉取请求，记录当前适用版本及重复检查结果。
2. 研究仓库保持稳定时，评分、报告、返回的 `researchCommit` 与实际评估代码对应。
3. 评估期间切换至另一条研究分支时，评分不会被归给另一条分支的算法；工具应正确保存原始关联，或明确返回无法安全提交的原因。
4. 评估期间共享分支推进到其他研究提交时，最终报告仍能明确对应原始评估代码。
5. 使用内容不同的研究分支和可识别实际输入的评估命令，核对评估目录内容、报告提交的父提交、报告正文及返回的提交编号，不能只检查接口返回成功。
6. B 设计至少 30 个有意义的自动行为测试点，记录命令、版本、替代范围和实际结果，再通过真实 DSH 注册工具执行独立核查。源码推导、测试替身和脚本故障均不能代替实际 DSH 证据。

## 验证记录

2026 年 10 月 31 日，A 根据用户明确接纳的决定登记源码线索。A 没有运行自动测试、启动 DSH、修改产品代码或操作远端。后续验证及远端维护由 B 执行。

## 自动核查进展（2026-10-31）

B 已在最新基线 `66885994ceadad83a237a27c1fc7de6419889c14` 运行[独立自动验收](dsh/evaluation-attribution-acceptance.test.mjs)。测试通过实际注册工具创建项目，在真实 Git 分离工作树执行 Python 评估，再分别保持研究仓库稳定、切换研究分支或推进当前研究分支。内存存储与调用会话替代 DSH 服务，评估等待仅用于稳定安排真实分支操作。

自动验收包含 59 个有效行为点，54 个通过、5 个失败；Node 计入父容器为 60 项、54 项通过和 6 项失败。稳定对照全部通过；分支切换时报告父提交与报告树属于算法乙，算法甲的评分进入乙分支；分支推进时，评分来自原算法，但返回报告的父提交和文件属于修订后的算法。失败来自代码与报告关联断言，没有依赖中断或脚本异常。原始报告见[自动结果](evidence/15-evaluation-attribution-baseline.txt)，Git 提交、实际输入、报告正文及返回值见[结构化记录](evidence/15-evaluation-attribution-baseline.json)。实际 DSH 的独立核查范围见下节。

## 实际 DSH 核查（2026-10-31）

B 在实际 DSH `0.2.2-alpha.2` 使用隔离状态目录、真实父会话、原始注册工具、持久项目存储、Git 研究分支、分离评估工作树和真实 Python 评估命令。诊断桥接仅调用实际注册工具，不调用模型。评估程序先记录实际输入和工作目录，再等待释放文件；B 在等待期间执行真实分支切换或提交推进，没有修改产品源码或替换 Git。

[实际脚本](dsh/current-evaluation-attribution.py)完成 56 项观察检查，全部通过，表示以下缺陷已经复现：

- 稳定研究分支对照中，评分、报告父提交及报告树都对应算法甲，另一条分支保持不变。
- 评估期间切换至算法乙的分支后，真实评估仍读取算法甲并输出分数 11；返回报告提交的父提交及文件却属于算法乙，乙分支接收甲算法的报告，原甲分支没有报告提交。
- 评估期间推进当前分支后，真实评估仍读取旧算法甲，报告提交的父提交和文件却属于尚未评估的修订算法。新提交仍可达，本场景没有观察到代码丢失。

全部原始输入、实际工作目录、分支提交、报告正文、返回值、公共项目快照与执行命令保存在[实际 DSH 记录](evidence/15-current-real-dsh-evaluation-attribution.json)。隔离 Host 已停止，记录确认进程不存在。首次脚本在稳定对照结束后读取公共快照时使用了错误字段路径，原始中断记录保存在[独立脚本尝试](evidence/15-real-dsh-fixture-shape-attempt.json)，不计入产品证据；修正为实际快照结构后才完成上述实测。

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_EVALUATION_OBSERVATIONS=tests/issues/evidence/15-evaluation-attribution-baseline.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/evaluation-attribution-acceptance.test.mjs

python3 tests/issues/dsh/current-evaluation-attribution.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/15-current-real-dsh-evaluation-attribution.json
```

## 远端同步与排重

发布前串行同步于北京时间 `2026-10-31T17:47:25.640846+08:00` 完成，本地、上游和派生仓库主分支仍为 `66885994ceadad83a237a27c1fc7de6419889c14`，主工作区保持干净。B 已检查上游全部议题和拉取请求，没有发现直接覆盖评估代码与报告提交关联错误的修复。上游 #11 关注报告查询与反馈，#7 关注 mission 计算任务起点，#16 关注研究代理回调归属；当前触发条件和验收要求分别独立。
