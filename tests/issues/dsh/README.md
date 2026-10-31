# 实际 DSH 复现操作

## 当前项目架构

旧版复现操作固定针对 campaign 架构。验证最新 project、mission 和 batch 实现时，使用独立启动器并显式指定源码工作区：

```bash
python3 tests/issues/dsh/launch-project.py --source /home/paulus-chang/项目/aleph
```

启动器把指定工作区的插件复制到新的临时目录，使用安装版 DSH 和原有诊断桥，打印被测提交与隔离目录。启动器不复制模型凭据，适用于通过真实注册工具执行无需模型请求的项目、任务、审批、批次和结果交付核查。需要模型的研究代理流程不在该启动器的默认验证范围内。

DSH 命令不在环境变量 `PATH` 中时，启动器仍可通过安装版入口运行。默认运行时为 `/opt/dsh-desktop-linux-bin/resources/app/dsh`，可通过 `--runtime` 指定其他目录。当前版本的健康检查见[项目架构健康记录](../evidence/project-health-2026-10-31.json)。该记录仅证明隔离服务和项目接口可用，不构成议题复现或修复验收。

完成验证后，确认目标进程的 `DSH_HOME` 与启动器打印的隔离目录一致，再停止该隔离服务。证据只保留必要请求、响应和版本信息，不包含登录令牌或凭据。

## 当前任务起点一致性核查

ALEPH-06 的[自动验收脚本](base-consistency-acceptance.test.mjs)核对实际服务、Git、runner 和结果交付。实际 DSH 场景单独运行：

```bash
python3 tests/issues/dsh/current-base-consistency.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/06-current-real-dsh-base-consistency.json
```

脚本通过实际注册工具创建项目、提案与审批，分别在提案后和审批后推进独立任务分支，再编排并运行。脚本核对 `preBatchTip`、组合源码、实际运行提交、公共快照、结果提交父节点和执行次数；结构化记录保存版本、命令、检查结果及验证边界，结束时停止隔离服务。当前测试结果与历史问题的关系见 [ALEPH-06](../06-mission-base-consistency.md)。

## 历史 campaign 架构

本目录使用安装版 DSH 创建隔离状态目录，并加载 `aleph-tests/dsh-plugin` 的副本。诊断插件仅提供真实会话创建、工具调用与观察入口；研究任务由实际 DSH 子代理完成。被测版本与观察结论见 [验证记录](../VALIDATION-2026-10-31.md)。

## 启动

默认运行时目录为 `/opt/dsh-desktop-linux-bin/resources/app/dsh`，可通过 `ALEPH_DSH_RUNTIME` 指定其他安装位置。模型服务需要本机已有可用配置。启动脚本会把已有 DSH 凭据复制到临时状态目录，权限为 `0600`；证据文件不包含凭据。

从 `aleph-tests` 根目录执行：

```bash
ALEPH_DSH_CONTROL_GIT=1 python3 tests/issues/dsh/launch-isolated.py
```

脚本先打印隔离目录 `root`，随后打印 DSH 启动日志。另开终端，把 `ALEPH_TEST_ROOT` 设置为打印的绝对目录，把 `ALEPH_TEST_URL` 设置为日志中的本机 HTTP 地址。以下命令要求这两个变量已经填写：

```bash
: "${ALEPH_TEST_ROOT:?填写隔离目录}"
: "${ALEPH_TEST_URL:?填写实际 DSH 地址}"
python3 tests/issues/dsh/exercise.py --root "$ALEPH_TEST_ROOT" --url "$ALEPH_TEST_URL" --scenario concurrency
python3 tests/issues/dsh/exercise.py --root "$ALEPH_TEST_ROOT" --url "$ALEPH_TEST_URL" --scenario race
python3 tests/issues/dsh/exercise.py --root "$ALEPH_TEST_ROOT" --url "$ALEPH_TEST_URL" --scenario continuation
```

`concurrency` 创建任务并连续派发，检查并发上限为 1 时实际运行数为 2。`race` 先阻塞 10 分任务的分支写入，待 20 分任务完成分支写入后释放阻塞，再比较保存分数与真实 Git 文件。该操作需要启动时启用 `ALEPH_DSH_CONTROL_GIT=1`。`continuation` 在首任务完成后等待约 90 秒，再读取排队状态与实际工具声明。

`race` 依赖单任务派发绕过并发限制的现有行为。未来修复并发限制后，需要在允许并行的活动中调整派发方式，再验证竞态；不能把前置条件不满足当作竞态已经修复。

每次运行都把请求、响应和观察结果写入隔离目录的 `exercise-场景.json`。现有正式证据位于上级 [evidence 目录](../evidence/)，包含原始实测中的任务与会话标识。

## 重启验证

先在已启动的隔离服务中派发等待任务：

```bash
python3 tests/issues/dsh/exercise.py --root "$ALEPH_TEST_ROOT" --url "$ALEPH_TEST_URL" --scenario restart-prepare
```

检查进程命令与 `DSH_HOME`，确认目标是本轮隔离服务后，以 `SIGKILL` 结束该服务进程。随后使用相同 `DSH_HOME`、相同 `reproduction` profile 与相同本机端口重新启动安装版 DSH。不要再次执行 `launch-isolated.py` 代替重启，该脚本每次会创建新的状态目录。

重启后执行：

```bash
python3 tests/issues/dsh/exercise.py --root "$ALEPH_TEST_ROOT" --url "$ALEPH_TEST_URL" --scenario restart-observe
```

脚本读取实际活动快照并查询原子代理是否仍在运行，检查任务保留 `running` 而原子代理已经不存在的组合。超过任务原定等待时长后，应再次观察并保存记录。原实测最终观察距任务创建约 6 分钟，结果见 [重启证据](../evidence/05-real-dsh-restart.json)。

完成后停止本轮隔离 DSH 服务。保留证据时只复制所需请求、响应和日志，不复制临时凭据。
