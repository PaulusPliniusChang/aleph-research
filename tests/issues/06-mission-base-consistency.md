---
id: ALEPH-06
status: dsh实测有问题
type: 缺陷
remote_issue: https://github.com/hapenia/aleph-research/issues/7
pull_request: null
---

# 任务记录的代码起点可能与实际起点不一致

## 当前版本适用性复核（2026-10-31）

当前主仓库版本为 `66885994ceadad83a237a27c1fc7de6419889c14`，被测产品没有未提交改动，插件入口为 `dsh-plugin/index-v2.js`。当前实现采用 project、mission 和 batch 模型。提案记录独立 mission 分支，编排批次时记录实际分支提交 `preBatchTip`，结果交付提交以该提交为父节点。

本轮自动验收的 76 个行为测试点全部通过；Node 报告额外计入父测试容器，显示 77/77。真实 DSH `0.2.2-alpha.2` 的 61 项检查全部通过。在已经验证的当前范围内，旧版记录与实际起点不一致的问题没有复现。文件开头的 `status` 保留历史实测结论，不表示当前版本已经复现；上游 [#7](https://github.com/hapenia/aleph-research/issues/7) 保持开放，等待结合本轮适用范围决定后续处理。本轮没有新增产品修复或重复议题。

### 当前实测范围

| 场景与关系 | 结果 |
| --- | --- |
| 单任务分支保持不变；分支在提案后推进；独立任务在审批后推进再组成批次。 | 自动验收全部通过，覆盖未变更的对照与合法的编排前源码变更。 |
| 真实 DSH 中，独立 alpha 任务在提案后推进，beta 任务在审批后推进，然后一起编排并运行。 | alpha 与 beta 均运行最新编排源码，各执行一次，批次结束后机器恢复空闲。 |
| 编排记录、公共快照与真实 Git 历史。 | `preBatchTip` 等于编排时实际任务分支提交，批次提交包含该提交。 |
| 实际运行起点与交付父节点。 | 任务运行组合后的批次提交；各自结果提交以记录的 `preBatchTip` 为父节点，`resultCommit` 等于对应任务分支实际末端提交。 |
| 结果隔离。 | 每个结果提交仅向对应任务起点加入各自的结果信封，保留原任务源码。 |

批次组合提交与单个任务分支起点具有不同用途。当前测试核对组合源码、记录字段和交付父节点的实际关系，不要求任务继承全局最优分支。本轮没有测试批次编排后再修改任务分支的情况，也不覆盖旧版 SOTA 自动继承、优化代理或远程机器。

自动验收使用当前真实 `ProjectService`、Git 合并、runner 和 shell 任务；磁盘 JSON 适配器及模块加载器替代 DSH 存储与工具包依赖。真实 DSH 核查另外通过诊断接口调用实际注册工具，使用真实持久存储、Git 与 runner，不调用模型。隔离宿主已经停止，原始宿主日志不纳入仓库。

### 复跑与证据

在 `aleph-tests` 根目录执行：

```bash
ALEPH_CURRENT_SOURCE=/home/paulus-chang/项目/aleph \
ALEPH_BASE_OBSERVATIONS=tests/issues/evidence/06-current-base-consistency.json \
node --experimental-loader /home/paulus-chang/项目/aleph/dsh-plugin/test/loader.mjs \
  --test tests/issues/dsh/base-consistency-acceptance.test.mjs

python3 tests/issues/dsh/current-base-consistency.py \
  --source /home/paulus-chang/项目/aleph \
  --output tests/issues/evidence/06-current-real-dsh-base-consistency.json
```

证据包括[自动验收脚本](dsh/base-consistency-acceptance.test.mjs)、[自动报告](evidence/06-current-base-consistency.txt)、[自动结构化记录](evidence/06-current-base-consistency.json)、[真实 DSH 脚本](dsh/current-base-consistency.py)与[真实 DSH 记录](evidence/06-current-real-dsh-base-consistency.json)。完整架构范围见[适用性复核](ARCHITECTURE-REVIEW-2026-10-31.md)。

## 旧版历史记录

下述复现、实际结果与证据针对旧 campaign 架构，保留原始结论供追溯。

## 问题

任务排队后，如果最优分支发生变化，派发时可能仍从旧起点创建工作目录，却把任务起点记录为最新最优分支，影响实验比较和结果追溯。

## 复现

1. 最优分支还是 `initialize` 时，排队两个任务。
2. 启动并完成首个任务，使最优分支变为 `sota/main`。
3. 派发原排队任务，对比 `baseBranch`、`baseCommit` 与实际提交的父提交。

## 实际结果

任务记录的 `baseBranch` 为 `sota/main`，但 `baseCommit` 和实际父提交仍是初始化提交，没有继承首个实验的代码。

## 预期结果

任务实际使用的起点、记录的分支与基线提交保持一致。排队或派发时确定起点均可，但必须一致执行并准确记录。

## 验证

DSH `0.2.2-alpha.2` 隔离环境实测确认。原始任务记录与真实 Git 提交关系见 [起点实测记录](evidence/06-real-dsh-base-consistency.json)，被测版本与自动测试见 [验证记录](VALIDATION-2026-10-31.md)。
