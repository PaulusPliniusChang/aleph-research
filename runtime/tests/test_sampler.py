import unittest

from aleph import sampler


class SamplerTest(unittest.TestCase):
    def test_probabilities_sum_to_one_and_respect_floor(self):
        probs, q, tau = sampler.probabilities(0.5)
        self.assertAlmostEqual(sum(probs.values()), 1.0)
        self.assertEqual(set(probs), set(sampler.STRATEGIES))
        self.assertTrue(all(value >= sampler.FLOOR for value in probs.values()))
        self.assertGreater(tau, 0)

    def test_low_exploration_favors_l0(self):
        low, _, _ = sampler.probabilities(0.1)
        high, _, _ = sampler.probabilities(0.9)
        self.assertGreater(low["L0"], high["L0"])
        self.assertGreater(high["L3"], low["L3"])

    def test_sample_is_deterministic(self):
        first = sampler.sample(0.7, seed=42)
        second = sampler.sample(0.7, seed=42)
        self.assertEqual(first, second)
        self.assertIn(first["strategy"], sampler.STRATEGIES)


if __name__ == "__main__":
    unittest.main()
