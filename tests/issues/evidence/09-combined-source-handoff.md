# PR26 与 PR29 恢复组合交接

状态：独立源码副本已经冻结，等待 B 独立自动验收与实际 DSH 验收。

源码副本为 `/tmp/aleph-controls-restart-combined-source`，没有 `.git`。准确基线为 PR26 的 `b1f9f048ae8cc7569e6a9e36dcafe119f2c02783`，恢复行为移植自 PR29 的 `96226147cd18f67ea9920f0e714532259295bdce`。原 PR26、PR29 官方工作树和此前冻结源码副本均未修改。

## 最终行为

普通 Host 启动恢复只观察计算进程，不发送停止信号，不创建停止文件，也不生成取消意图。新执行通过持久回执核对 Linux 启动编号、进程起始时间和进程组；活跃或无法确认身份的执行继续保留原批次和机器归属。旧执行以及命令准备窗口继续采用 PR29 的可读工作目录观察；无法枚举整个 `/proc` 时保留归属。单个不可读进程目录不被推断为批次成员。

启动仅捕获当时的批次执行和代理记录。原有五秒监视器持续观察该批次集合，忽略后续创建或替换的执行和代理。捕获的计算自然退出后，尚未交付的任务标记为中断，原有摘要字段、已交付任务、工作目录、输出和 Git 分支保持可检查。机器释放同时核对 machineId、batchId 和存在时的 executionId。完成收尾后，等待中的 finishing 项目允许进入 finished。合法的未执行 forming 批次继续占用原机器。

显式取消与普通恢复具有不同授权来源。持久状态已经为 cancelling 的批次在启动时继续 PR26 停止协议；普通恢复后新发起的取消同样停止准确进程组、保存诊断并保留已交付结果。缺少命令回执但没有 go 文件的显式取消继续创建停止文件，阻止延迟启动。InfraOptimizer 激活回执无法在重启后重新获得，普通恢复保留 active 和机器占用；显式取消继续返回 complete: false，保留 cancelling 状态和调查现场。

## 产品测试

完整产品命令为 `npm test`，工作目录为 `/tmp/aleph-controls-restart-combined-source/dsh-plugin`。最终日志为 `/tmp/aleph-controls-restart-combined-product-tests-run2.txt`。Node 共报告 262 项通过，失败、取消和跳过均为 0。其中组合专属有效行为点为 40 项，移植的 PR29 有效行为点为 41 项，既有有效行为点为 151 项，另有父测试容器 30 项。

检查实际执行 detached Linux 命令、持久回执与启动许可协议、真实 Python 批次运行器、真实临时 Git 工作树，以及插件原有五秒定时器。组合专属检查覆盖普通恢复保留活计算、自然退出后准确释放、暂停和 finishing、恢复后显式取消、重启继续持久取消、回执身份不明、InfraOptimizer 不确定性、执行替换和新机器归属。原 PR26 的完整取消、准入和进程组产品测试同时通过。

首次完整运行因新隔离副本缺少 zod，相关测试文件未能加载。该环境失败日志保留在 `/tmp/aleph-controls-restart-combined-product-tests.txt`。随后仅在独立副本的 node_modules 中创建指向已安装 zod 的只读依赖引用，第二次完整运行全部通过。依赖引用不属于产品补丁，冻结清单不包含 node_modules。

## 导入与独立验收

相对准确 PR26 基线仅修改清单中的文件，补丁为 `/tmp/aleph-controls-restart-combined-changes.patch`，摘要清单为 `/tmp/aleph-controls-restart-combined-manifest.json`。B 应按差异导入，避免覆盖其他已整合改动。

B 的独立自动验收与实际 DSH 验收各需至少 30 个有效行为点。验收应同时保持 PR26 的机器与任务唯一归属、暂停与结束的准入行为、显式停止协议，以及 PR29 的合法 forming 占用、真实 Host 退出后保留活计算、自然退出后由原五秒定时器收尾。实际 Host 退出、普通恢复和显式取消仍由 B 在实际 DSH 中独立证明。C 没有执行正式 DSH 验收，没有提交、推送或创建拉取请求。

实现仍限定单 Host 写入，计算后代必须留在原进程组，旧执行仅在可读工作目录范围内观察；重启恢复没有新增自动结果交付、重新运行或跨 Host 执行服务。
