# 当前架构与历史议题复核

## 复核范围

2026 年 10 月 31 日，主仓库与上游 `main` 均为 `6688599`。`aleph-tests` 是同一 Git 仓库的独立工作区，分支为 `codex/aleph-regression-tests`，基线为 `a77893e`，保留旧版 campaign 实现和历史测试。

当前插件由 `dsh-plugin/package.json` 导出 `index-v2.js`。顶层状态为 project，任务经过提案、审批、批次编排、运行和结果提交。旧版 `aleph_start_campaign`、`aleph_enqueue_mission`、`aleph_compose_batch`、`aleph_run_next` 与 `aleph_run_available` 没有在当前入口注册。旧源码文件仍存在不表示当前插件继续使用该实现。

本轮已通过 GitHub 命令行核对远端议题与拉取请求，并安全同步远端引用。主仓库没有新增远端提交，现有用户改动均已保留。

## 历史议题对应关系

| 本地议题 | 上游议题 | 当前适用性与剩余核查 |
| --- | --- | --- |
| ALEPH-01 | [#3](https://github.com/hapenia/aleph-research/issues/3) | 已正式核查最新主分支 `785a7e9`：54 个自动行为点有 5 个保护断言失败，实际 DSH 的 66 项观察确认单台机器重复计算。现有 PR26 的同一提交已通过 54 个独立自动行为点与 59 项实际保护观察。PR26 未合并，多机器范围继续保留，详见独立文档。 |
| ALEPH-02 | [#4](https://github.com/hapenia/aleph-research/issues/4) | 旧预算模型未沿用；当前预算需求需要重新确认。 |
| ALEPH-04 | [#5](https://github.com/hapenia/aleph-research/issues/5) | 旧 SOTA 晋升路径未沿用；旧竞态证据不适用于当前结果交付路径。 |
| ALEPH-05 | [#6](https://github.com/hapenia/aleph-research/issues/6) | 当前版本已经独立复现；修复 [PR #13](https://github.com/hapenia/aleph-research/pull/13) 已创建，67 个独立验收点、52 项产品测试与真实 DSH 完成后重启、活跃计算重启检查均通过。详见独立议题文档。 |
| ALEPH-06 | [#7](https://github.com/hapenia/aleph-research/issues/7) | 最新主分支 `785a7e9` 已正式通过 159 个独立自动行为点与 149 项实际 DSH 观察。编排前合法推进正确捕获；编排后或计算中推进明确拒绝不安全交付，后续提交和文件保持。当前已测范围不复现旧缺陷，旧 PR21 保持关闭，管理状态保留。 |
| ALEPH-07 | [#8](https://github.com/hapenia/aleph-research/issues/8) | 旧 L0 至 L3 策略模型未沿用，旧验收条件需要重新确认。 |
| ALEPH-08 | [#9](https://github.com/hapenia/aleph-research/issues/9) | 当前审批与编排流程不同，自动推进需求需要重新确认。 |
| ALEPH-09 | [#10](https://github.com/hapenia/aleph-research/issues/10) | 旧 campaign 控制范围已经变化，当前控制需求需要分别确认。 |
| ALEPH-10 | [#11](https://github.com/hapenia/aleph-research/issues/11) | 当前已有结果信封和评测报告路径，内容与交付完整性需要独立验证。 |
| ALEPH-11 | [#12](https://github.com/hapenia/aleph-research/issues/12) | 旧 SOTA 模型未沿用，当前人工选择与回退需求需要重新确认。 |
| ALEPH-13 | [#14](https://github.com/hapenia/aleph-research/issues/14) | 当前架构已经双阶段复现同批次重复优化删除活动目录；修复 [PR #15](https://github.com/hapenia/aleph-research/pull/15) 依赖 #13，组合产品 168 项、优化 65 个行为点、恢复 67 个行为点及实际 DSH 场景均通过，详见独立议题文档。 |
| ALEPH-12 | [#1](https://github.com/hapenia/aleph-research/issues/1) | 当前无项目空状态仍对应同类问题，现有 [PR #2](https://github.com/hapenia/aleph-research/pull/2) 已包含当前架构修复。 |

各独立文件保留原有 `status` 与历史证据。元数据复核保留已存在的远端链接，后续独立实测结论记录在对应议题中。ALEPH-05 和新接纳的 ALEPH-13 已确认适用于当前架构，现有上游 #6 将补充当前复现范围；其余旧状态不能代替当前版本的验证结论。现有议题均不重复创建。

## 现有修复

PR #2 的分支为 `fix/aleph-12-console-empty-state`，提交为 `ecfef49`，目标为上游 `main`。本轮核对时，拉取请求尚未合并，GitHub 返回合并状态 `CLEAN`。修复已经识别当前 `aleph/no-project` 响应并兼容旧版 `aleph/no-campaign`，无需再次实现同一修复。

此前记录的 24 项自动测试属于历史验证，未达到本轮至少 30 个测试点的要求。本轮尚未重新执行该修复的自动测试和真实 DSH 验证，因此不把历史通过记录计作本轮验收结果。

## 后续验证要求

新接纳议题先保存在本工作区并使用“可疑”状态。B 随后针对明确版本执行至少 30 个有意义的自动测试点，再在真实 DSH 环境核查；依赖故障、测试脚本错误和旧接口缺失均不能证明当前产品缺陷。

修复由 C 在隔离工作区完成，B 负责复测、提交到派生仓库并创建上游拉取请求。旧测试分支的产品源码和用户既有测试改动不能随文档维护进入当前产品修复。

## 公开证据

议题文档、复跑脚本与验收记录已经发布到派生仓库的独立证据分支 `evidence/2026-10-31-validation`，固定提交为 `23f4c0f67f78c39639c9d3a877b337e3907b7499`，入口见[公开证据目录](https://github.com/PaulusPliniusChang/aleph-research/tree/23f4c0f67f78c39639c9d3a877b337e3907b7499/tests/issues)。该分支以当前 `main` 为基础，仅加入已经提交的 `tests/issues` 文件，没有加入旧测试分支的产品实现或用户未提交测试改动。本地管理字段和注释保持，GitHub 议题正文不包含管理头和前导注释。
