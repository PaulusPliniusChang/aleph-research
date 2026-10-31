# AlephResearch 设计（精简版）

> 状态：需求讨论后的当前设计，仅讨论，不进入实现。细节附录：`docs/notes/leader-workspace-topology.md`（拓扑）、`docs/notes/exploration-strategy-design.md`（策略采样）。
>
> 精简原则：只保留运行所必需的机制；由拓扑自然产生的性质不单列为需求。

## 1. 目标

自动研究循环：Leader 定方向、探索度与预算；Researcher 在独立 worktree 中做代码改动与实验；Leader 侧评测给出分数；分支按分数进化。运行在单机单卡，成本、磁盘与并发受控。

## 2. 组成

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| 插件仓库 | 当前 `aleph-research` 仓库 | DSH 插件、Python 运行时、preset、客户端与文档 |
| Leader 工作区 | 研究项目目录 | 评测框架、测试集、SQLite（gitignore）与 research 子模块 |
| Research 子模块 | Leader 工作区内 | 被研究代码；`initialize` 分支定义适配契约 |
| Researcher worktree | Leader 工作区之外 | 每个任务独立的代码检出 |
| SQLite | Leader 工作区 `.aleph/state.sqlite` | 战役、任务、评分、分支与预算状态 |
| 评测器 | Leader 工作区内 | 按提交运行评测框架与测试集，返回结构化分数 |

插件在项目初始化时创建或绑定 Leader 工作区。Leader 工作区是研究项目的核心工作区，默认按安全环境对待；插件保持即插即用，容器不作为依赖。

## 3. 角色

- Leader：DSH 会话，选择 `aleph` 模式；负责目标、方向、探索度、预算与分支取舍。
- Researcher：临时子代理，一次任务处理一步；读取简报与分支上下文，编辑 worktree，提交结果。
- Composer：批次调度与资源分配，队首优先与回填。
- InfraOptimizer：跨任务的执行效率优化，覆盖缓存、环境与运行参数。
- Evaluator：Leader 侧评测框架，输出分数与失败摘要。

## 4. 任务与状态

任务是最小执行单元，字段包含 id、类型、父分支、基线提交、命令、资源需求、优先级、超时、预算、结果、分数与成本。

SQLite 由运行时服务单写者持有，使用 WAL 与短事务；Leader 工具、界面动作与 subagent 工具都经运行时提交命令，subagent 不直接打开数据库文件。表覆盖战役、任务、结果、分支、SOTA、策略采样与预算；保留 schema 版本字段，不引入迁移框架、审计表或额外日志系统。

队列语义为优先级、队首优先、回填、去重与重试。任务完成由评测器确认，失败也是合法结果。

## 5. 分支、契约与提交

`initialize` 契约在项目启动时由用户与 Leader 确定，确定后只读；变更只在用户明确要求时进行。researcher 分支从 `initialize` 或 SOTA 派生，评测框架在任务启动前检查契约。

分支模型为 `initialize` → `sota/<campaign>` → `exp/<campaign>/<mission>`。researcher 只在 worktree 中编辑文件，不运行 git；提交、推送与评测由 Leader 侧运行时执行。分数与测试通过后更新 SOTA；L2 改动在合并干净时自动晋级，异常时回退到上一 SOTA。

git 承载代码、任务分支与实验结构；SQLite 承载调度与评分状态。

## 6. 探索度

探索度是派发策略的动作层参数，不影响模型采样温度。策略谱系为 L0 精修、L1 增量、L2 重构、L3 探索；按探索度对策略做 Boltzmann 采样，Q 表示单位成本的期望增益。

调度采用探索优先：预算分阶段，停滞时重升温，预算接近上限时强制利用。策略约束由运行时校验改动行数、文件范围与依赖锁。

评测由 Leader 侧执行，测试集不进入 researcher 工作区；researcher 只接收分数与失败摘要，不需要额外的隐藏测试或防作弊机制。

## 7. 调度与资源

Composer 负责批次编排、显存画像、队首优先与回填；InfraOptimizer 维护成本画像与缓存策略；预算覆盖 token、显卡时间与磁盘占用；评测与训练共用硬件时排队。

## 8. 界面

DSH 模式选择 `aleph`；控制台主面板包含战役列表、分支树与 SOTA、任务队列、评分曲线、资源与成本、探索度控制。会话内只放状态徽标、入口与任务摘要。操作包括暂停、终止任务、回退 SOTA、调整探索度与预算。

## 9. 持久化

SQLite 位于 Leader 工作区并加入 `.gitignore`；运行时服务唯一写者，WAL 模式。git 承载代码与分支，SQLite 承载状态；不额外维护日志归档、备份框架或审计流水。磁盘上限通过任务产物与 worktree 清理控制。

## 10. 非目标与不做的设计

- 不做容器化运行、独立系统用户加固与强制不可见机制；Leader 工作区默认安全，隔离依靠工具边界与 DSH 沙箱。
- 不把隐藏测试集、防作弊、评分防篡改、开发集与考试集分离列为需求；测试集本来就不在 researcher 工作区。
- 不做审计日志、SQLite 迁移框架与备份框架。
- 不做多机、Kubernetes、多租户、容器化部署。
- 不做 MAP-Elites 与多样性档案；首版只维护 SOTA。
- 不做固定槽位池与 btrfs 快照；每个任务使用普通 worktree。
- 不做 O2 专用常驻 Host 与 O3 双 Host；首版为 O1 桌面 Host 加独立实验 daemon。
- 不做自动论文写作、文献检索与自动修改评测协议。

## 11. 待确认

- Leader 工作区初始化流程与目录模板。
- `initialize` 契约模板与启动校验项。
- SQLite 表结构与任务结果 schema。
- 首个研究项目与任务契约。
- 模型路由与预算上限。
- 探索度默认参数与策略约束阈值。
- 运行输出保留范围。

## 12. 已定决议摘要

- 当前仓库是插件仓库；Leader 工作区由插件初始化创建或绑定。
- SQLite 单写者，位于 Leader 工作区并 gitignore。
- `initialize` 契约启动确定后只读，变更需用户要求。
- researcher 只编辑 worktree，Leader 侧代提交。
- 插件即插即用，不依赖容器；Leader 工作区默认安全。
- 不把隐藏测试集与防作弊列为需求。
