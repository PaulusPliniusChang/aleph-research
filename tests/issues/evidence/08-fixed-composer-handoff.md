# 上游 #9：Composer 的 Infra 工具权限修复

独立副本 `/tmp/aleph-08-composer-infra-fix-source` 已冻结，准确基线为主分支 `785a7e9ce6420f62c5187662a3e8ba7b6d5977bf`。副本没有 `.git`，官方工作树和其他冻结副本未修改。

修复仅将 `aleph_run_infra` 的注册条件改为允许 `aleph` 和 `aleph-composer`，使持续运行的 Composer 能够调用提示已经要求使用的工具。研究代理、InfraOptimizer、普通角色、没有预设或没有会话的调用方均不获得该工具。Leader 原有权限和其他工具的角色条件保留。README 同步说明角色职责。运行器、忙碌机器的提前编排策略和多机器流程均未修改。

完整产品命令为 `npm test`，工作目录为副本的 `dsh-plugin`。首次完整运行报告 47 项通过，失败、取消和跳过均为 0；包含 38 个新增有效行为点、父测试容器 2 项和既有测试 7 项。日志为 `/tmp/aleph-08-composer-infra-product-tests.txt`。

新增测试通过 `apply` 捕获实际注册定义与权限谓词，先按当前会话预设筛选工具，再执行 Host 回调，禁止隐藏工具或 Leader 派发回退。权限检查覆盖 Composer、Leader、研究代理、InfraOptimizer、普通角色、缺少会话与预设、运行时预设切换，以及审批、研究启动和 Composer 启动权限隔离。持续流程实际运行临时 Git 项目、工作树、Python 批次计算、Infra 交接提交和任务结果提交，覆盖获批触发、忙碌时保留排队和机器归属、直接执行、Infra 执行、完成通知及再次审批唤醒原 Composer。计算各执行一次，结果归属原任务分支。模型动作、会话和存储由产品测试替代；该结果不等于实际 DSH 验收。

B 应按清单和差异导入，再独立执行至少 30 个有效自动行为点和实际 DSH 验收，重点核对实际 Composer 模型输入的工具清单、真实 Infra 激活及交接、计算完成和后续队列执行。既有缺陷脚本包含明确标注的直接执行对照，修复验收必须证明 Infra 路径实际可用，不能依赖该对照。迁移说明在准确修复 PR 编号和验收结果到齐后更新。

清单为 `/tmp/aleph-08-composer-infra-manifest.json`，补丁为 `/tmp/aleph-08-composer-infra-changes.patch`。C 没有执行正式 DSH 验收，没有提交、推送或创建拉取请求。
