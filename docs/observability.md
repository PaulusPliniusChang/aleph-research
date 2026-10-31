# 可观测性（OpenTelemetry）

AlephResearch 运行时通过 OpenTelemetry 导出 traces 与 metrics，使用 OTLP HTTP/protobuf 传输。SDK 是可选依赖：未安装或未配置导出端点时，所有埋点退化为无操作，不影响研究流程。

## 启用

```bash
uv pip install --python /path/to/python -r runtime/requirements-otel.txt
export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
export OTEL_SERVICE_NAME=aleph-research
aleph telemetry
```

端点可以是 OTLP Collector 或兼容后端。通用端点后自动追加 `/v1/traces` 与 `/v1/metrics`；也可以分别设置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 与 `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`。`ALEPH_OTEL_ENABLED=0` 可显式关闭，`ALEPH_OTEL_ENABLED=1` 可在已设置端点时强制启用。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 未设置 | OTLP HTTP 根地址；未设置且未强制启用时不导出 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | 未设置 | traces 精确端点，覆盖通用端点 |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | 未设置 | metrics 精确端点，覆盖通用端点 |
| `OTEL_SERVICE_NAME` | `aleph-research` | 资源中的服务名 |
| `ALEPH_ENV` | `local` | 资源中的部署环境 |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | metrics 导出周期，单位毫秒 |

## Traces

当前自动产生的 span：

| Span | 关键属性 |
| --- | --- |
| `aleph.cli` | `aleph.command`、`aleph.workspace` |
| `aleph.mission` | campaign、mission、strategy、branch、status、score、trace id |
| `aleph.worktree.create` | mission、branch |
| `aleph.lfs.cow` | worktree、files、bytes |
| `aleph.researcher.run` | mission、子进程退出码 |
| `aleph.commit` | mission、commit、是否产生改动 |
| `aleph.evaluate` | mission、commit、score、rows、错误 |
| `aleph.sota.promote` | campaign、mission、score |

mission 的 `result` 与 tick 摘要都会带 `trace_id`，便于把实验记录关联到 trace。researcher 子进程与评测子进程通过 W3C `TRACEPARENT` 继承当前 span 上下文；评测脚本需要把该变量继续传给提交进程。

## Metrics

当前指标：

- `aleph.cli.invocations`
- `aleph.missions` 与 `aleph.mission.duration`
- `aleph.researcher.duration`
- `aleph.eval.score`
- `aleph.sota.promotions`
- `aleph.strategy.samples`
- `aleph.branch.score`、`aleph.eval.rows`
- `aleph.budget.spent`、`aleph.disk.used`
- `aleph.lfs.cow.files`、`aleph.lfs.cow.bytes`、`aleph.lfs.cow.duration`

指标属性使用 campaign、mission、strategy 与 status 等低基数标签；任务内容、隐藏标签与数据值不进入遥测。

## 未来扩展

- 增加 OTel logs，把运行日志与 trace 关联。
- 在 DSH 控制台显示 trace 链接与指标曲线。
- 增加 GPU、磁盘与队列深度等 observable gauge。
- 接入 DSH 已有的 OpenTelemetry 基础设施时，保持相同 service name、资源属性与 span 命名。

当前实现只支持 OTLP HTTP/protobuf；gRPC 与自定义 exporter 通过后续适配层扩展。
