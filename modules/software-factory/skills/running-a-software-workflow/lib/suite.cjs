// The state of the result of the full suite, in the form that qory writes it:
// {tests, failed, skipped, output_tail}, with counts that are integers of 0 or more. The
// verb findings round of core reads the file and calls this rule through the registry.
'use strict';

// suiteState returns 'failed' when a test failed, 'not_run' when the suite ran no test or
// skipped each one, 'passed' otherwise, and null for data in no such form.
function suiteState(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const count = (key) => (Number.isSafeInteger(data[key]) && data[key] >= 0 ? data[key] : null);
  const [tests, failed, skipped] = ['tests', 'failed', 'skipped'].map(count);
  if (tests === null || failed === null || skipped === null) return null;
  if (failed + skipped > tests || typeof data.output_tail !== 'string') return null;
  if (failed > 0) return 'failed';
  if (tests === skipped) return 'not_run';
  return 'passed';
}

module.exports = suiteState;
