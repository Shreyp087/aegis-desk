import {
  formatDecisionBenchmarkReport,
  runDecisionModelBenchmark,
} from "./decisionModelHarness";

/**
 * Runs the deterministic decision-model benchmark and prints a readable tuning report.
 */
function main(): void {
  const { metrics, results } = runDecisionModelBenchmark();
  console.log(formatDecisionBenchmarkReport(metrics, results));
}

main();
