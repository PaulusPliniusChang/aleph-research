---
id: ALEPH-17
status: dsh实测有问题
type: 缺陷
remote_issue: null
pull_request: null
---

<!-- 本地管理说明：用户于北京时间 2026-10-31 18:20 接纳该候选，要求先登记为“可疑”。B 已在最新上游 785a7e9c 完成 67 个有效自动行为点和真实 DSH 核查，确认超时后存在活跃评分后代。GitHub 正文应移除管理头及本段前导注释，本地文件保留完整内容。 -->

# 评估超时后，评分子进程可能继续运行，而评估目录已经被删除

## 当前情况

Host 调用项目的评估命令，通过 `ALEPH_SOLUTION_DIR` 读取研究代码，并设置十分钟超时。研究代码可能位于临时评估工作区，也可能位于研究代理自有工作区。评估命令可以启动额外工作进程，例如由入口脚本启动另一个 Python 进程完成实际评分。

现有超时处理只直接约束 Host 启动的进程，没有终止完整进程树的处理。超时错误发生后，Host 进入清理流程，强制移除本次创建的临时 Git 工作区。若工作进程没有随着入口进程退出，实际评分仍可能运行，而读取的研究目录已经被删除；研究代理自有工作区会保留，但遗留计算仍可能继续。建议优先级为 P2。

最新上游 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 已完成正式核查。67 个有效自动行为点中，60 个通过、7 个失败；实际 DSH 的 67 项观察全部符合复现条件。远端议题及拉取请求链接待补充。

## 使用例子

评估入口启动一个 Python 工作进程。工作进程读取模型、占用显卡并计算分数，入口脚本等待结果。

十分钟后，Host 向直接启动的进程发送结束信号。如果评估包装程序没有把信号转发给工作进程，工作进程可能继续计算。Host 此时已经将评估作为失败处理，并开始删除评估目录。研究代理重试后，还可能启动另一份评分计算，与遗留计算同时占用资源。

实际核查使用普通 Python 入口、工作进程和后代进程复现了该关系。`bash` 可能将最后一条命令直接替换为入口程序；因此，直接子进程可能是 shell，也可能是评估入口。需要核查的对象是实际计算后代，不能假定所有命令都保留相同的 shell 层次。

## 触发条件与影响范围

评估超过十分钟，实际计算位于 Host 直接子进程的后代中，且后代没有随直接子进程收到的结束信号一起退出时，存在遗留计算风险。若入口正确转发信号、后代具有相应退出机制，或实际计算已经结束，则不满足遗留条件。

潜在影响包括失败后继续占用处理器、显卡或内存，重试时新旧评分重叠，以及工作进程继续访问已删除目录时出现读写失败。具体后果取决于评估程序和文件使用方式，不能宣称每次超时都必然遗留进程、资源已经泄漏或工具永久挂起，也没有证据表明评分结果已经被错误记录。

该问题限定为已有评估命令的超时和清理，不判断 InfraOptimizer 应保留的批次产物，不要求改变任务存储策略。

## 最新源码复核与证据

B 于北京时间 `2026-10-31 18:06:44` 串行获取上游和派生仓库更新，并在干净主工作区执行仅快进拉取。本地、上游和派生仓库主分支均保持 `66885994ceadad83a237a27c1fc7de6419889c14`。B 核对了远端议题和拉取请求，确认相同源码条件仍存在，未找到覆盖同一评估超时路径的公开修复。这是源码与远端适用性复核，不等同于产品测试。

- [进程调用包装](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L20)使用 `promisify(execFile)`。
- [运行辅助函数](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L102)仅传入超时、输出上限、目录和环境，没有独立进程组、后代进程登记或递归终止处理。
- [评估调用](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L492)执行 `bash -lc project.evalCommand`，超时为 `600_000` 毫秒。
- [清理流程](https://github.com/hapenia/aleph-research/blob/66885994ceadad83a237a27c1fc7de6419889c14/dsh-plugin/index-v2.js#L497)在 `finally` 中强制移除 Git 工作区并递归删除目录，没有确认整棵评估进程树退出的步骤。

A 另行阅读当前安装的 Node 运行时源码。`execFile` 的超时处理先销毁标准输出和标准错误管道，再调用 `child.kill(options.killSignal)`；`ChildProcess.prototype.kill` 对当前进程句柄发送信号，默认信号为 `SIGTERM`。该调用不等同于递归终止子孙进程。此项属于源码检查，没有运行产品行为测试。

Node 会关闭输出管道，不能仅根据后代继承输出管道就推断工具必然无限等待。B 应当保存真实进程状态，以判定实际计算是否仍然存活。

## 与现有议题的区别

- [ALEPH-05](05-restart-recovery.md)／上游 [#6](https://github.com/hapenia/aleph-research/issues/6) 和 [拉取请求 #13](https://github.com/hapenia/aleph-research/pull/13) 处理 Host 重启后的批次监督与恢复。本议题在 Host 正常运行时，由评估超时触发；拉取请求 #13 没有替换评估的既有 `execFile` 超时路径。
- [ALEPH-09](09-campaign-controls.md)／上游 [#10](https://github.com/hapenia/aleph-research/issues/10) 处理缺少人工暂停、恢复和取消。本议题检查已有自动超时是否真正停止其计算，不新增人工操作。
- [ALEPH-15](15-evaluation-report-attribution.md)／上游 [#19](https://github.com/hapenia/aleph-research/issues/19) 处理正常评分完成时报告写入错误分支。本议题处理超时失败后的进程存活和目录清理，触发条件及验收要求不同。

## 期望行为与验收条件

1. 评估超时后，该次评估启动的真实计算停止，Host 能够确认相关进程已经退出。
2. 评估进程仍访问工作区时，Host 不应直接删除目录；无法确认退出时，应保留可诊断的明确状态。
3. 重试评估不会因为上一轮超时处理不完整而与遗留评分同时运行。
4. 正常快速评估仍能返回分数并清理目录，入口正确转发结束信号的情况也能正常结束。
5. B 构建至少 30 个有意义的自动行为测试点，并在实际 DSH 中核查注册工具、真实进程和 Git 工作区。证据应包含进程编号、父子关系、超时前后存活状态和目录删除时间。
6. 为减少等待而缩短超时，必须公开说明修改范围；不得用进程终止替身代替实际信号行为。测试结束后需要清理夹具产生的全部进程。

## 验证记录

2026 年 10 月 31 日，A 根据用户明确接纳的决定登记源码线索，状态为“可疑”。A 没有运行该候选的产品测试或实际 DSH，没有修改产品代码或操作远端。后续自动测试、实测、上传和提交由 B 负责。


## 最新上游正式核查

B 对主分支 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf` 运行正式检查。最新评估命令的当前目录是 `evalRoot` 或项目目录，研究代码路径则通过 `ALEPH_SOLUTION_DIR` 提供。当前问题应描述为研究代码目录可能被删除，不能描述为超时后总是删除评估命令的当前目录。

当前源码：[进程调用](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/index-v2.js#L117)、[临时与自有路径选择](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/index-v2.js#L756)、[评估与清理](https://github.com/hapenia/aleph-research/blob/785a7e9ce6420f62c5187662a3e8ba7b6d5977bf/dsh-plugin/index-v2.js#L791)。本轮没有修改产品源码。

### 精确期限替代

[测试预加载模块](dsh/evaluation-timeout-preload.mjs)只匹配 `bash -lc`、原期限为 `600_000` 毫秒、命令包含 `aleph-timeout-probe.py` 的调用，将该调用的期限改为 `1_200` 毫秒，再调用原始 `execFile`。其他 Git 命令、计时器、信号和进程 API 没有被替换。产品默认十分钟限制保持原值。

预加载模块 SHA256 为 `500ca308b266f80e946f4ef3bf35f1a4789e08cd8cbe0d6d0e75bbc2ee235d43`。证据保存匹配命令、原期限、替代期限、调用目录和进程编号。该运行证明原超时处理在较短期限下的真实行为，没有等待默认十分钟，不能称为未改变期限的原样运行。

[实际评分夹具](dsh/aleph-timeout-probe.py)启动普通 Python 工作进程与后代，没有脱离进程组，也没有在后代中忽略结束信号。入口收到实际 `SIGTERM` 后退出，Host 没有向评分后代发送同样的信号。外部记录保存 `/proc` 的进程状态、父进程编号、进程组、会话编号与启动时间，以及持续心跳和研究文件存在状态。夹具最长运行二十秒，测试结束时另按进程身份清理活跃进程。

### 自动行为检查

```bash
ALEPH_TIMEOUT_ADAPTER_LOG=tests/issues/evidence/17-evaluation-timeout-adapter.jsonl ALEPH_TIMEOUT_OBSERVATIONS=tests/issues/evidence/17-evaluation-timeout-baseline.json node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs --import ./tests/issues/dsh/evaluation-timeout-preload.mjs --test tests/issues/dsh/evaluation-timeout-acceptance.test.mjs
```

[自动脚本](dsh/evaluation-timeout-acceptance.test.mjs)执行实际注册工具、Git、Python 进程与操作系统信号；存储、调用会话和工具定义服务使用内存适配器，服务加载使用产品已有测试加载器。研究代理自有工作区场景在内存项目中设置对应记录，并创建真实 Git 工作区。该部分不属于实际 DSH 会话验证。

检查覆盖正常快速成功、受控非零退出、临时路径超时和自有路径超时。67 个有效行为点中，60 个通过、7 个失败；Node 另计父测试容器，汇总为 68 项、60 项通过、8 项失败。

失败仅涉及超时后的后代存活、心跳继续，以及临时目录已被活跃后代观察为删除。正常评分、真实评估引用、失败不写成功记录、直接入口结束、Git 清理、自有目录保留均通过。原始记录见[自动输出](evidence/17-evaluation-timeout-baseline.txt)、[进程与项目记录](evidence/17-evaluation-timeout-baseline.json)和[期限匹配记录](evidence/17-evaluation-timeout-adapter.jsonl)。

### 实际 DSH

```bash
python3 tests/issues/dsh/current-evaluation-timeout.py --source /home/paulus-chang/项目/aleph --output tests/issues/evidence/17-current-real-dsh-evaluation-timeout.json
```

[启动脚本](dsh/current-evaluation-timeout.py)使用已安装 DSH 和真实注册工具、持久化存储及项目接口。Host 与探测脚本均运行 Node `v26.12.1`。真实研究子代理通过原始启动服务创建独立工作区，并执行 Bash；仅模型响应和等待时机使用本地确定性适配器。评估本身使用相同的真实 Python 夹具和精确期限替代，不调用外部模型。

67 项实际观察全部符合复现条件，正常成功与非零退出对照通过。

| 场景 | 实际入口 | 工作进程 | 评分后代 | 超时后的观察 |
| --- | --- | --- | --- | --- |
| 临时工作区 | 291239 | 291249 | 291250 | 入口收到 SIGTERM 后结束；工作进程及评分后代仍活跃；评分后代继续写心跳，并观察研究目录和输入文件均已不存在。 |
| 研究代理自有工作区 | 291417 | 291427 | 291428 | 入口结束后评分后代仍活跃并继续写心跳；研究工作区和输入文件保持存在。 |

临时路径的工具返回约为 1237 毫秒，自有路径约为 1225 毫秒。后代心跳时间晚于工具返回时间，证明工具失败返回与实际计算停止并不等价。失败没有写入成功评估历史或最高分，也没有推进研究分支。当前未执行重试叠加、显卡占用或主动脱离进程组的实验，不能据此宣称已经覆盖任意进程树、实际显卡泄漏或所有评估包装程序。

原始记录见[实际 DSH 输出](evidence/17-current-real-dsh-evaluation-timeout.txt)、[完整进程与时间证据](evidence/17-current-real-dsh-evaluation-timeout.json)和[实际 Host 期限匹配](evidence/17-current-real-dsh-adapter.jsonl)。夹具最后按进程启动身份清理全部活跃评分进程，各场景 `remainingActive` 均为空；隔离 Host 的进程 `290792` 已退出，进程编号不存在。

早期缺少产品测试加载器、初始字段读取与快速成功观察时机错误均单独保留为测试脚本调整记录，没有计作产品失败。实际 DSH 首次读取评估历史时使用了错误的公共快照层级，已在正式运行前修正为 `project.evaluations`；该中断另存于 `17-current-real-dsh-shape-attempt.*`。最终实际脚本完整通过。
