# 第一版实现状态

## 已实现

- `runtime/`：Python 运行时与 `aleph` CLI。
  - `aleph init PATH` 创建 leader 工作区：eval 框架、测试集、research 嵌套仓库（`initialize`、`sota/main`、`exp/a`、`exp/b`、`exp/c`）与 SQLite 状态库。
  - `aleph mission add` 入队任务并按探索度采样策略。
  - `aleph tick` 单步执行：worktree、命令、Leader 侧提交、Leader 侧评测、SOTA 晋级。
  - `aleph run` 批量执行；`aleph status` 输出状态。
  - 状态写入 `.aleph/state.sqlite` 与 `.aleph/dashboard.json`；当前工作区指针写入 `~/.aleph/current_workspace`。
- `dsh-plugin/`：DSH 插件包。
  - `main` 面板 key `aleph`：只读控制台。
  - `sidebar.panellist` id `aleph`：侧栏入口。
  - `/api/aleph/health` 与 `/api/aleph/snapshot`。
  - `aleph` 与 `aleph-researcher` preset。
- `aleph`：从仓库直接运行运行时的启动器；已建立 `~/.local/bin/aleph` 软链接。

## 已验证

- 运行时测试全部通过，覆盖策略采样、端到端 SOTA 晋级、Leader 侧提交、cycle 与 CLI。
- 玩具战役跑通：`exp/c` 以 1.0 分晋级 `sota/main`。
- 插件 Host 路由在 mock 上下文下返回 200；缺少工作区指针时返回 `aleph/no-workspace`。
- `node --check` 通过。
- 隔离 DSH 实验通过：使用独立 `DSH_HOME=/tmp/aleph-dsh-lab`、独立 `HOME` 与 `aleph-lab` web profile，安装 bundle 后启动 Web Host；页面侧栏出现 `Aleph` 入口，点击后打开只读控制台，显示战役、SOTA 1.000、任务表与分支表。截图见 `docs/assets/aleph-console.png`。
- 隔离 Host 的 `/api/aleph/health` 返回 200，`/api/aleph/snapshot` 返回 dashboard 原文；`--dump-config` 显示 `preset-aleph` 与 `preset-aleph-researcher`。
- 实验中修复 Host 路由：Fetch `resource` 形式在该运行时会返回 400，改为 node `handler` 形式后正常。

## 未验证

- 当前 DSH 未安装该插件（按要求只在隔离环境实验），因此当前 DSH 的模式选择器与控制台尚未验证。
- 隔离环境没有账号与工作区会话，模式选择器未展开验证；preset 仅通过组合配置确认。
- 控制台的窄屏与极端主题未逐一验证。

## 安装与试用

隔离环境复现：

```bash
./scripts/dsh-lab.sh
# 按脚本输出启动 Web Host，浏览器打开带 token 的地址
```

当前 DSH 中安装需要批准 `plugin_manager` 的 `install_bundle`，目标：

`/home/hapenia/Projects/aleph-research/dsh-plugin`

安装后新建会话选择 `Aleph Research` 模式，侧栏出现 `Aleph` 图标。控制台读取 `~/.aleph/current_workspace` 指向的 `.aleph/dashboard.json`。

Researcher 生命周期已收紧：每个 researcher mission 只对应一个 worktree 与一个提交；researcher 通过 `ALEPH_HANDOFF_PATH` 写交接报告，缺失报告会失败；researcher 完成研究并退出后所有研究者提交才被压缩为单个提交，handoff 写入提交信息并带 Aleph 尾部字段；worktree 与 `ALEPH_RESEARCHER_HOME` 在任务结束后删除，tick 结果标记 `reclaimed: true`。

Git LFS 已默认启用：leader 工作区与研究仓库写入 `.gitattributes` 并执行 `git lfs install --local`；模型与常见二进制产物走 LFS，文本数据与隐藏测试集保留普通 Git 对象。模型文件以 LFS 指针提交，worktree 检出可正常还原。

LFS CoW 也已启用：mission 与评测 worktree 在检出后把 LFS 文件替换为指向本地 LFS 对象的 reflink。btrfs 实测中，替换前 worktree 的模型独占数据块约 176K，替换后独占降为 0、共享约 176K；不支持 reflink 的文件系统回退普通复制。

OpenTelemetry 已接入：运行时通过 OTLP HTTP 导出 spans 与 metrics，未安装 SDK 或未配置端点时退化为无操作。`aleph telemetry` 查看配置；本地 collector 实测收到 `aleph.cli`、`aleph.mission`、`aleph.worktree.create`、`aleph.lfs.cow`、`aleph.commit`、`aleph.evaluate`、`aleph.sota.promote` 等 span，以及任务、评分、分支、预算、磁盘与 LFS 指标。

## 限制

- 控制台只读，没有暂停、终止、回退与调参操作。
- 运行时是 CLI 循环，没有常驻调度器与并发执行。
- researcher 子代理的自动派发尚未接入；当前 mission 通过 CLI 入队，命令在 worktree 中执行。
- 评测器为玩具实现，测试集为单个隐藏目标值。
- 当前 DSH 未写入插件；隔离实验使用独立 DSH_HOME 与端口。
