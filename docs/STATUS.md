# 状态

## 已完成

- 顶层状态改为 DSH workspace/project，使用 `aleph_project` storage domain。
- research repo 与 mission repo 分离；mission repo 从 `template` 初始化。
- Mission 提案、Leader 审批、approved queue 已实现。
- MissionComposer 已作为 `aleph-composer` 子代理接入，创建机器绑定的 batch
  并合并 mission 分支。
- InfraOptimizer 已作为 `aleph-infra` 子代理接入，在 batch worktree 中优化
  合并代码，然后运行 batch entrypoint。
- 单一 batch entrypoint 会为每个 mission 写 result envelope。
- 每 mission 的 result commit 会 cherry-pick 回 pre-batch mission branch。
- researcher 由 `aleph_run_researcher` 启动，只等待自有 mission，调用
  `aleph_evaluate`，Host 将报告写入 research commit。
- 控制台显示项目、研究仓库、mission 仓库、机器、编排 agent、batch 与 mission
  结果提交。

## 隔离 DSH 验证

项目 `p-5e07aced`：

- mission `mission/test2` 经历 propose、approve、batch、run。
- batch `b-b034c9fc` 状态 done。
- 结果文件 `results/m-test2/result.json` 写入 mission branch。
- researcher evaluate 返回 score `1`，research commit `982b6cf` 写入报告。

项目 `p-1877e11f`：

- MissionComposer 创建 batch `b-61469d71`。
- researcher 子会话 `f4fce692` 在 research repo 完成研究、evaluate，并写入
  research commit `7fe854e`。

## 待完成

- InfraOptimizer batch 运行的完整闭环验证（当前一次运行仍停在 agent 阶段）。
- 自动化测试。
- 多机接口。
- 更完整的 Composer 冲突解决与结果归因。
