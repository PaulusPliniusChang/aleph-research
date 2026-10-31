# 当前架构与历史议题复核

## 当前结论

2026 年 10 月 31 日，B 已对现有 **16 条独立议题全部完成当前架构的正式核查**，每轮自动套件至少包含 30 个不同的有效行为点，并另外执行实际 DSH 核查。正式核查完成不表示缺陷全部解决，也不表示拉取请求已经合并。下表引用各议题的完整范围、脚本、原始结果与历史记录；父测试容器不计入有效行为点。

主仓库与上游 `main` 的准确基线为 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。B 定期串行获取上游和派生仓库，并在候选核查、正式验收和发布前额外核对主分支。干净主工作区仅执行快进同步，用户既有测试改动继续保留。

当前插件入口为 `dsh-plugin/index-v2.js`。研究代理提交 mission，批准后由 Composer 编排 batch，InfraOptimizer 优化批次代码，Host 执行并交付结果。旧 campaign、数值预算、L0 至 L3 策略以及旧派发工具没有直接沿用；旧源码存在不能证明当前入口仍使用旧模型。

## 全部议题的当前结论

| 本地议题与证据 | 上游议题 | 当前正式结论 | 修复与剩余范围 |
| --- | --- | --- | --- |
| [ALEPH-01](01-run-next-concurrency.md) | [#3](https://github.com/hapenia/aleph-research/issues/3) | 当前主分支仍有单机器重叠编排与重复计算，自动 54 点有 5 个保护断言失败，实际 66 项观察确认复现。 | PR26 的现有互斥通过 54 个独立自动点和 59 项实际观察，现由 PR30 整合。多机器需求继续保留。 |
| [ALEPH-02](02-run-next-budget.md) | [#4](https://github.com/hapenia/aleph-research/issues/4) | 当前预算适用性部分的自动 30 点、实际 30 点全部通过。数值预算与旧额度工具没有注册；审批和机器预留可以验证，但不能表示金额或累计计算额度限制。 | 通过迁移说明记录旧模型边界，不恢复旧字段；多机器预算需求未据此宣布完成。 |
| [ALEPH-04](04-sota-promotion-race.md) | [#5](https://github.com/hapenia/aleph-research/issues/5) | 当前最优结果一致性没有复现旧晋升竞态。联合历史查询套件自动与实际各 172 点全部通过，唯一归属本议题 21 点、报告查询 151 点。 | 当前使用项目最优记录与报告引用；结论限同一 Host 的当前更新路径，不表示多机器已完成。 |
| [ALEPH-05](05-restart-recovery.md) | [#6](https://github.com/hapenia/aleph-research/issues/6) | 当前重启收尾残留已经复现，原自动恢复修复不能代替本轮结论。 | PR29 已通过独立自动与实际各 66 点，PR30 再与控制修复整合。普通重启继续保留仍在运行的计算，显式取消执行停止协议。 |
| [ALEPH-06](06-mission-base-consistency.md) | [#7](https://github.com/hapenia/aleph-research/issues/7) | 最新主分支自动 159 点、实际 149 项全部通过。编排前合法修改被捕获，编排后推进明确拒绝不安全交付并保留后续提交。 | 当前已测范围不复现旧缺陷。旧 PR21 已关闭且未合并。 |
| [ALEPH-07](07-research-strategy-instructions.md) | [#8](https://github.com/hapenia/aleph-research/issues/8) | 当前研究目标和上下文传递的自动 34 点、实际 34 点全部通过，联合预算套件共 64 点。后续目标更新传给新研究代理，不改写原代理初始上下文。 | 当前任务策略保存在任务清单，不存在旧 L0 至 L3 结构化机制；通过迁移说明记录。 |
| [ALEPH-08](08-continuous-research.md) | [#9](https://github.com/hapenia/aleph-research/issues/9) | 当前自动 40 点有 1 点失败，实际 40 点有 7 点失败，同一根因为 Composer 的实际工具列表缺少 `aleph_run_infra`。直接运行路径可连续处理后续任务。 | PR31 已通过产品 47 项、独立自动与实际各 40 个有效点；实际 Composer 调用 Infra，未使用缺工具回退。忙碌预编排与多机器完整行为未验证。 |
| [ALEPH-09](09-campaign-controls.md) | [#10](https://github.com/hapenia/aleph-research/issues/10) | 当前项目控制缺项已经复现；旧 campaign 控制接口不适合作为当前验收入口。 | PR26 提供暂停、继续、结束和取消，并通过独立自动 75 点、实际 77 项及重启 12 项；这些数量与 #14 的准备窗口共享，现由 PR30 整合。 |
| [ALEPH-10](10-mission-reports.md) | [#11](https://github.com/hapenia/aleph-research/issues/11) | 当前报告与历史查询可以定位真实评分、源码及报告引用；自动父会话反馈仍有残留，已经独立实测。 | PR28 通过独立自动 58 点和实际 51 项，保留原父会话的原生自动结束通知。父会话丢失后的持久补投不在范围内。 |
| [ALEPH-11](11-sota-selection-rollback.md) | [#12](https://github.com/hapenia/aleph-research/issues/12) | 当前已有选择最优接口，但移动已检出分支会使文件与引用不一致；自动 95 点有 10 点失败，实际 95 项确认。 | PR27 通过独立自动与实际各 116 点，移动前拒绝已检出目标并给出准确保存与切换说明。 |
| [ALEPH-12](12-console-no-campaign-empty-state.md) | [#1](https://github.com/hapenia/aleph-research/issues/1) | 当前主分支自动 37 点、实际浏览器 41 项全部通过。原生无项目响应正常显示创建引导，真实项目创建后轮询更新。 | 当前已测范围不复现原缺陷。旧 PR2 已关闭且未合并；有项目窄屏宽表布局不属于本轮修复。 |
| [ALEPH-13](13-infra-duplicate-start.md) | [#14](https://github.com/hapenia/aleph-research/issues/14) | 当前角色登记前的准备窗口仍会删除首个优化目录，自动 36 点有 4 点失败，实际 Git 与 DSH 时序确认。 | PR26 在目录操作前预约执行，组合验收同时覆盖真实 Infra Bash 与取消，现由 PR30 整合。旧 PR15 已关闭且未合并。 |
| [ALEPH-14](14-researcher-callback-ownership.md) | [#16](https://github.com/hapenia/aleph-research/issues/16) | 当前主分支自动 50 点、实际 31 项全部通过。先结束的真实代理不会改写后续运行代理的状态与摘要。 | 当前已测范围不复现旧批量改写，旧 PR18 已关闭且未合并。父会话通知另属 #11。 |
| [ALEPH-15](15-evaluation-report-attribution.md) | [#19](https://github.com/hapenia/aleph-research/issues/19) | 当前固定报告和引用已改进，但自有工作目录中的未提交输入仍可造成评分与记录代码不一致，已经双阶段复现。 | PR25 的最新增量要求提交后评估，并固定独立快照。产品 152 项、独立自动与实际各 146 点通过；超时集成另有自动与实际各 69 点通过。 |
| [ALEPH-16](16-console-agent-records.md) | [#22](https://github.com/hapenia/aleph-research/issues/22) | 当前客户端读取代理列表位置错误，自动 41 点有 24 点失败，实际浏览器 23 项确认运行与完成记录均不可见。 | PR24 通过独立自动 41 点和实际浏览器 23 项，恢复真实代理编号、状态与摘要。宽表布局未改造。 |
| [ALEPH-17](17-evaluation-timeout-processes.md) | [#23](https://github.com/hapenia/aleph-research/issues/23) | 当前评估超时可能遗留后代进程，自动 67 点有 7 点失败，实际 67 项确认。 | PR25 先确认普通所属进程组停止，再清理独立快照；最新组合头的超时集成自动与实际各 69 点通过。主动脱离进程组与跨 Host 恢复不在范围内。 |

共享套件的数量只记录一次，不能将其重复计算为各议题的独有检查点。自动存储或会话替身、确定性模型、受控 Git 调度以及缩短超时的独立副本均在各自文档中说明；上述证据不能表示自然发生频率或外部模型自主完成全部流程。

## 已发布修复与尚未交付的工作

当前 [PR24](https://github.com/hapenia/aleph-research/pull/24)、[PR25](https://github.com/hapenia/aleph-research/pull/25)、[PR26](https://github.com/hapenia/aleph-research/pull/26)、[PR27](https://github.com/hapenia/aleph-research/pull/27)、[PR28](https://github.com/hapenia/aleph-research/pull/28)、[PR29](https://github.com/hapenia/aleph-research/pull/29) 、[PR30](https://github.com/hapenia/aleph-research/pull/30) 与 [PR31](https://github.com/hapenia/aleph-research/pull/31) 共 8 份请求开放，均未合并。PR30 整合 PR26 与 PR29，前序请求保持原提交，仅在正文说明整合关系。

PR30 的准确提交为 `a85ccea4a6e7da7f2c56708627cbd1a873b7493a`，产品 Node 测试 262 项通过，其中有效行为点 232 个、父容器 30 个；B 独立自动和实际 DSH 各 105 个有效点通过。实际检查包括强制停止 Host 后保留原计算、原有定时器观察自然结束、准确释放及明确取消，支持范围继续限定为单 Host 写入。

PR31 的准确提交为 `12325013bec147895a6b8e58c3b910bc239b78f9`，解决 #9 的 Composer 工具权限缺口。[PR32](https://github.com/hapenia/aleph-research/pull/32) 已发布架构迁移说明，准确提交为 `45a56fb590c9db67bd7a47d5060259e38349fac8`，唯一新增文件为 `docs/architecture-migration.md`，尚未合并。文档记录已移除的旧接口、当前替代流程及尚未覆盖的需求。该轮执行引用、映射、冻结哈希与发布回读核对，没有新增产品行为测试或实际 DSH 运行；原始交接与核对见[冻结清单](evidence/architecture-migration-final-manifest.json)、[文档引用核对](evidence/architecture-migration-final-reference-review.json)、[正式发布记录](evidence/architecture-migration-publication.json)及[公开文档副本](evidence/architecture-migration-published.md)。上游关闭议题、关闭旧拉取请求或本轮通过测试，均不能自动表示全部需求已经解决。

## 状态与历史维护

各独立文件保留原有 `status`、前导注释和历史证据。手动维护状态没有被新测试覆盖；上游原有开放或关闭状态继续保留，不重新打开旧请求。旧主分支 `6688599` 的失败与旧 PR 的验收仅作历史，不代表当前基线。

议题与代码均通过已授权的 Git 和 GitHub CLI 发布。代码进入派生仓库后创建上游拉取请求；本地文档保留管理头和注释，GitHub 议题正文移除管理头与前导注释，并将证据链接转换为不可变的公开提交路径。证据分支为 `evidence/2026-10-31-validation`，每次发布的准确公共提交记录在对应议题与维护日志中。
