# 状态

## 已完成

- Host 插件改为 DSH 原生实现：campaign 状态通过 `ctx.storageDomain` 的
  `aleph_research` 域持久化，不再写 `~/.aleph`、dashboard 文件或独立 SQLite。
- Leader 工具已注册：`aleph_start_campaign`、`aleph_status`、
  `aleph_enqueue_mission`、`aleph_run_next`、`aleph_set_exploration`。
- 自定义 preset 已修复并启用：`Aleph Research` 与 `Aleph Researcher` 在
  选择工作区后可从模式选择器进入。
- researcher 通过 `ctx.subagents.startActivation` 启动为本地子代理，任务
  结束后由 Host 服务单提交、写入 handoff、评测、更新 SOTA 并回收 worktree。
- 控制台读取 Host API，显示最新战役、任务、分支与计数。
- 旧的 Python 运行时、SQLite 队列与 `aleph` CLI 已删除。

## 隔离 DSH 验证

环境：独立 `DSH_HOME=/tmp/aleph-dsh-lab2`，独立端口、独立工作区。

- 插件安装后 Host 正常激活，`/api/aleph/health` 返回 `aleph_research`。
- 通过 `aleph_start_campaign` 创建战役 `c-c1498ff8`，通过
  `aleph_enqueue_mission` 入队，通过 `aleph_run_next` 启动子代理
  `72baaaea-034b-427e-81eb-efb4849e36f9`。
- 子代理完成研究并写出交接报告；Host 服务将其压缩为单个提交
  `4d7135f`，父提交为基线 `68281d5`，`initialize..sota/main` 的提交数为 1。
- 提交信息包含 `Handoff:` 与 `Aleph-Mission`、`Aleph-Campaign`、
  `Aleph-Strategy`、`Aleph-Base-Commit` 尾部字段。
- 评测返回 `score: 1`，SOTA 更新为 `sota/main`；worktree 已删除。
- 状态在 Host 重启后保留；控制台截图见 `docs/assets/aleph-console.png`。

## kunlungpt 案例

在独立 DSH 的会话工作区内运行了真实案例副本：

- 工作区：`/tmp/aleph-dsh-lab2/leader/kunlungpt`
- 战役：`c-cd6dec80`
- 任务：`m-6d6f5d96`，隐藏集得分 `72.9076`
- 提交：`06e7dce`，父提交 `dc1959b`，`initialize..sota/main` 提交数为 1
- SOTA：`sota/main`，分数 `72.9076`
- worktree 已回收，控制台显示任务、分支、分数与已花费。

首次把案例工作区放在会话工作区之外时，DSH sandbox 对 researcher 只提供
只读权限，任务无法写回真实 worktree。Host 服务已增加 workspace 边界校验：
战役工作区必须是 DSH 会话工作区或其子目录，否则在派发前拒绝。

## 限制

- 控制台只读，最新战役之外的选择尚未提供。
- 还没有暂停、预算强制与多任务并发。
- 评测协议由项目提供，尚未内置通用任务模板。
- Git LFS/CoW 与 OpenTelemetry 尚未迁移到新的 Host 插件。
