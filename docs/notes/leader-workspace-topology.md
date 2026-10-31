# Leader 工作区与 Research 子模块（拓扑）

> 当前设计附录；正文见 `docs/requirements/00-requirements-discussion.md`。

## 1. 拓扑

```text
aleph-research/                    # 插件仓库，当前仓库
  dsh-plugin/                      # DSH Host 与 Client 插件
  runtime/                         # Python 运行时
  presets/                         # aleph 与 aleph-researcher 模式
  client/                          # 控制台前端资源

<leader-workspace>/                # 研究项目核心工作区，由插件初始化创建或绑定
  .gitignore                       # 排除 .aleph/state.sqlite
  .aleph/state.sqlite              # SQLite 状态库
  eval/                            # 自动化评测框架
  testsets/                        # 测试集
  research/                        # research 子模块
    initialize 分支                 # 适配契约

~/.aleph/worktrees/<campaign>/<mission>/   # researcher worktree，位于 leader 工作区之外
```

## 2. SQLite

- 位置：`<leader-workspace>/.aleph/state.sqlite`，加入 `.gitignore`。
- 运行时服务是唯一写者；WAL 与短事务；读取方使用只读连接。
- 表：campaigns、missions、results、branches、sota、strategy_samples、budgets；保留 schema 版本字段。
- Leader 工具、界面动作与 subagent 工具都经运行时提交命令；subagent 不直接打开数据库文件。
- 不做迁移框架、备份框架与审计表。

## 3. initialize 契约

- 在项目启动时由用户与 Leader 确定，确定后只读；变更只在用户明确要求时进行。
- 内容为研究代码入口、配置 schema、评测钩子、依赖清单与最小可运行基线。
- 分支模型：`initialize` → `sota/<campaign>` → `exp/<campaign>/<mission>`。
- 评测框架在任务启动前检查契约；不兼容的任务拒绝执行。

## 4. Worktree 与提交

- researcher worktree 从 research 子模块签出，位于 leader 工作区之外；每个任务一个目录。
- researcher 只编辑文件，不运行 git；提交、推送与评测由 leader 侧运行时执行。
- worktree 只作为文件系统视图，git 元数据不交给 subagent。

## 5. 评测流程

- researcher 提交 commit 与结果摘要；leader 侧按提交创建临时检出，运行评测框架与测试集。
- 分数与失败摘要写入 SQLite，并回传给任务发起方。
- 测试集位于 leader 工作区，不进入 researcher 环境，不单独设计隐藏与防作弊机制。
- 分数与测试通过后更新 SOTA；L2 改动在合并干净时自动晋级，异常时回退到上一 SOTA。

## 6. 工具边界与信任

- 插件即插即用，容器不作为依赖。
- Leader 工作区按安全环境对待；隔离依靠工具边界与 DSH 沙箱，subagent 工具不暴露 leader 工作区路径。
- 同一用户读取的残余风险由信任模型接受，不单独设计加固机制。

## 7. 待确认

- Leader 工作区初始化流程与目录模板。
- `initialize` 契约模板与校验项。
- SQLite 表结构与任务结果 schema。
