import os
import unittest

from aleph import observability


class ObservabilityTest(unittest.TestCase):
    def setUp(self):
        self.saved = dict(os.environ)
        os.environ["ALEPH_OTEL_ENABLED"] = "0"
        os.environ.pop("OTEL_EXPORTER_OTLP_ENDPOINT", None)
        os.environ.pop("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", None)
        os.environ.pop("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", None)
        observability.reset()

    def tearDown(self):
        observability.reset()
        os.environ.clear()
        os.environ.update(self.saved)

    def test_endpoint_does_not_override_explicit_disable(self):
        os.environ["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:4318"
        os.environ["ALEPH_OTEL_ENABLED"] = "0"
        observability.reset()
        obs = observability.get()
        self.assertFalse(obs.enabled)
        self.assertEqual(obs.reason, "disabled")

    def test_disabled_observability_is_a_noop(self):
        obs = observability.get()
        self.assertFalse(obs.enabled)
        self.assertEqual(obs.reason, "disabled")
        with obs.span("test.span", {"key": "value"}) as span:
            span.set_attribute("another", 1)
            span.add_event("event")
        obs.add_counter("test.counter", 1, {"key": "value"})
        obs.record_histogram("test.histogram", 0.5, {"key": "value"}, unit="s")
        self.assertIsNone(obs.trace_id())
        self.assertIsNone(obs.span_id())
        env = {"A": "1"}
        self.assertIs(obs.inject_env(env), env)
        status = obs.status()
        self.assertFalse(status["enabled"])
        self.assertIn("available", status)


if __name__ == "__main__":
    unittest.main()
