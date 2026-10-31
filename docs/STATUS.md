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

## 多 agent、Composer 与 InfraOptimizer

已实现并在控制台可见：

- Composer：`aleph_compose_batch` 创建一个批次，按 L0 到 L3 轮换生成任务。
- 多 agent：`aleph_run_available` 按并发上限启动多个 researcher 子代理；
  Host 服务分别提交、评测与回收各自 worktree。
- InfraOptimizer：代码优化 agent，在独立 worktree 中针对实际机器优化代码，
  返回 `infra/...` 分支；不设置预算、并发或评测运行时约束。
- 容量与成本读数：Host 探测 CPU、GPU、内存与磁盘，维护成本画像和评测缓存，
  由 Leader 侧使用。

案例批次验证：

- 战役 `c-73eb500a`
- 批次 `b-c87bfc13`
- 任务 `m-1b0da1ee`、`m-9bde95ac` 并发完成，隐藏集分数均为 `72.9076`
- SOTA 更新为 `sota/main`，worktree 均已回收，已花费为 2
- 控制台截图见 `docs/assets/aleph-console.png`

## Composer 与 InfraOptimizer agent

两者已改为独立 DSH agent，而不是 Host 辅助函数：

- `aleph_run_infra` 为 `aleph-infra` 子代理创建独立代码 worktree；子代理优化代码、
  运行短基准并返回 `infra/...` 分支。
- `aleph_run_composer` 启动 `aleph-composer` 子代理，检查状态并创建批次。
- 角色 agent 的 child session、状态与摘要记录在 campaign 中，并显示在控制台
  “编排 agent”区域。

在战役 `c-73eb500a` 上验证：

- Composer 子会话 `9867adc4-5f11-4f8b-ad86-08b354d0f913`，创建批次
  `b-75bf349d`，包含 L3、L2、L1、L0 任务各一。
- Composer 子会话 `a3a4fcac-4353-4700-80c7-664e9ab5a2a4` 创建批次
  `b-e616e166`，为任务设置优先级 90、80、55、30 与显存估算
  5200、1300、3600、1800 MB。
- InfraOptimizer 子会话 `194df601-a4e3-4fbd-b2c8-682ea981cb31` 在
  `infra-2bb3c4dd` worktree 中优化 `experiment.py`，返回分支
  `infra/c-c1498ff8/i-a251463c`；提交 `6bec2ca` 包含代码改动与
  `ALEPH_HANDOFF.md`。
- 角色 agent 状态均为 done，控制台显示角色、子会话、分支与摘要。

Composer 侧已实现 VRAM 画像、优先级队列与回填。成本画像、评测缓存、
评测运行时参数、成本预算向量与评测串行队列属于 Host/Leader 侧控制，
不属于 InfraOptimizer 的代码优化职责。

## Researcher 算力边界

Researcher 的 Host prompt 与 `aleph-researcher` preset 已加入算力约束：

- 禁止在单次 mission 内启动大规模训练、长任务、多 seed/多配置扫描、
  多 GPU 作业、数据规模生成、批量基准测试与后台任务。
- 允许读文件、聚焦修改、快速测试、单次小规模拟合/评测与有界命令。
- 需要重算力时，researcher 必须停止并写出提案，由 Leader 新建 mission，
  Composer 按批次与显存画像合并运行。

## 限制

- 控制台只读，最新战役之外的选择尚未提供。
- 还没有暂停工具；预算只按任务数校验，没有 GPU 时间与 token 成本模型。
- 评测协议由项目提供，尚未内置通用任务模板。
- Git LFS/CoW 与 OpenTelemetry 尚未迁移到新的 Host 插件。
