"""OpenTelemetry observability for the AlephResearch runtime.

The runtime keeps telemetry optional. Traces and metrics are exported over OTLP
when the OpenTelemetry SDK is installed and an OTLP endpoint is configured. All
call sites use the same small facade, so missing packages or an unset endpoint
degrade to no-ops without changing runtime behavior.
"""

from __future__ import annotations

import atexit
import json
import logging
import os
from contextlib import contextmanager
from typing import Any, Iterator

try:  # pragma: no cover - availability depends on the deployment
    from opentelemetry import metrics as otel_metrics
    from opentelemetry import propagate, trace
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.trace import Status, StatusCode

    _SDK_AVAILABLE = True
except Exception:  # noqa: BLE001 - the runtime must run without the optional SDK
    _SDK_AVAILABLE = False

LOGGER = logging.getLogger("aleph.observability")


def _flag(name: str) -> bool:
    value = os.environ.get(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _clean_attributes(attributes: dict[str, Any] | None) -> dict[str, Any]:
    if not attributes:
        return {}
    result: dict[str, Any] = {}
    for key, value in attributes.items():
        if value is None:
            continue
        if isinstance(value, (str, bool, int, float)):
            result[key] = value
        elif isinstance(value, (list, tuple)) and all(
            isinstance(item, (str, bool, int, float)) for item in value
        ):
            result[key] = list(value)
        else:
            result[key] = json.dumps(value, ensure_ascii=False, default=str)
    return result


class _NoopSpan:
    def set_attribute(self, key: str, value: Any) -> None:  # noqa: D401
        return None

    def add_event(self, name: str, attributes: dict[str, Any] | None = None) -> None:
        return None

    def record_exception(self, exception: BaseException) -> None:
        return None

    def set_status(self, status: Any) -> None:
        return None

    def get_span_context(self) -> Any:
        return None


class Observability:
    """Small facade over OTel traces and metrics with a no-op fallback."""

    def __init__(self) -> None:
        self.service_name = os.environ.get("OTEL_SERVICE_NAME", "aleph-research")
        self.endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
        forced = os.environ.get("ALEPH_OTEL_ENABLED")
        requested = _flag("ALEPH_OTEL_ENABLED") if forced is not None else bool(self.endpoint)
        self.enabled = False
        self.reason = ""
        self.tracer = None
        self.meter = None
        self._instruments: dict[tuple[str, str], Any] = {}
        self._shutdowns: list[Any] = []
        if not requested:
            self.reason = "disabled"
            return
        if not _SDK_AVAILABLE:
            self.reason = "opentelemetry SDK is not installed"
            LOGGER.warning("aleph: telemetry requested but the OpenTelemetry SDK is missing")
            return
        if not self.endpoint:
            self.reason = "OTEL_EXPORTER_OTLP_ENDPOINT is not set"
            return
        try:
            self._configure()
            self.enabled = True
            self.reason = "enabled"
        except Exception as exc:  # noqa: BLE001 - telemetry must never break work
            self.reason = f"setup failed: {exc}"
            LOGGER.warning("aleph: telemetry setup failed: %s", exc)

    def _signal_endpoint(self, signal_path: str) -> str:
        base = self.endpoint.rstrip("/")
        if base.endswith("/v1/traces") or base.endswith("/v1/metrics"):
            return base
        return base + signal_path

    def _configure(self) -> None:
        resource_attributes = {
            "service.name": self.service_name,
            "service.version": _version(),
            "deployment.environment": os.environ.get("ALEPH_ENV", "local"),
        }
        resource = Resource.create(resource_attributes)
        traces_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or self._signal_endpoint("/v1/traces")
        metrics_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") or self._signal_endpoint("/v1/metrics")
        trace_provider = TracerProvider(resource=resource)
        trace_provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint=traces_endpoint, timeout=10))
        )
        trace.set_tracer_provider(trace_provider)
        metric_reader = PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint=metrics_endpoint, timeout=10),
            export_interval_millis=_interval_ms(),
        )
        meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
        otel_metrics.set_meter_provider(meter_provider)
        self.tracer = trace.get_tracer("aleph-research", _version())
        self.meter = otel_metrics.get_meter("aleph-research", _version())
        self._shutdowns = [trace_provider.shutdown, meter_provider.shutdown]
        atexit.register(self.shutdown)

    @contextmanager
    def span(self, name: str, attributes: dict[str, Any] | None = None) -> Iterator[Any]:
        if not self.enabled or self.tracer is None:
            yield _NoopSpan()
            return
        with self.tracer.start_as_current_span(name, attributes=_clean_attributes(attributes)) as span:
            try:
                yield span
            except Exception as exc:  # noqa: BLE001 - annotate then re-raise
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise

    def mark_error(self, span: Any, message: str) -> None:
        if self.enabled and span is not None:
            try:
                span.set_status(Status(StatusCode.ERROR, message))
            except Exception:  # noqa: BLE001
                pass

    def add_counter(self, name: str, value: int | float = 1, attributes: dict[str, Any] | None = None) -> None:
        self._instrument("counter", name, "1").add(value, _clean_attributes(attributes))

    def record_histogram(self, name: str, value: int | float, attributes: dict[str, Any] | None = None, unit: str = "") -> None:
        self._instrument("histogram", name, unit).record(value, _clean_attributes(attributes))

    def _instrument(self, kind: str, name: str, unit: str) -> Any:
        key = (kind, name)
        existing = self._instruments.get(key)
        if existing is not None:
            return existing
        if not self.enabled or self.meter is None:
            return _NoopInstrument()
        if kind == "counter":
            instrument = self.meter.create_counter(name, unit=unit)
        else:
            instrument = self.meter.create_histogram(name, unit=unit)
        self._instruments[key] = instrument
        return instrument

    def trace_id(self) -> str | None:
        if not self.enabled:
            return None
        context = trace.get_current_span().get_span_context()
        if context is None or not context.is_valid:
            return None
        return format(context.trace_id, "032x")

    def span_id(self) -> str | None:
        if not self.enabled:
            return None
        context = trace.get_current_span().get_span_context()
        if context is None or not context.is_valid:
            return None
        return format(context.span_id, "016x")

    def inject_env(self, env: dict[str, str]) -> dict[str, str]:
        """Propagate the current W3C trace context into a child process environment."""
        if not self.enabled:
            return env
        carrier: dict[str, str] = {}
        try:
            propagate.inject(carrier)
        except Exception:  # noqa: BLE001
            return env
        for key, value in carrier.items():
            env[key.upper()] = value
        return env

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "available": _SDK_AVAILABLE,
            "endpoint": self.endpoint or None,
            "service_name": self.service_name,
            "reason": self.reason,
        }

    def shutdown(self) -> None:
        for shutdown in self._shutdowns:
            try:
                shutdown()
            except Exception:  # noqa: BLE001
                LOGGER.debug("aleph: telemetry shutdown failed", exc_info=True)
        self._shutdowns = []


class _NoopInstrument:
    def add(self, value: Any, attributes: dict[str, Any] | None = None) -> None:
        return None

    def record(self, value: Any, attributes: dict[str, Any] | None = None) -> None:
        return None


def _version() -> str:
    try:
        from . import __version__

        return __version__
    except Exception:  # noqa: BLE001
        return "0.0.0"


def _interval_ms() -> int:
    raw = os.environ.get("OTEL_METRIC_EXPORT_INTERVAL", "60000")
    try:
        return max(1000, int(raw))
    except ValueError:
        return 60000


_INSTANCE: Observability | None = None


def get() -> Observability:
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = Observability()
    return _INSTANCE


def reset() -> None:
    """Testing hook: drop the singleton so environment variables are re-read."""
    global _INSTANCE
    if _INSTANCE is not None:
        _INSTANCE.shutdown()
    _INSTANCE = None
