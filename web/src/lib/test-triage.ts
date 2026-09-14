export const testStatuses = ['failed', 'blocked', 'not_run', 'running', 'passed'] as const
export type TestStatus = typeof testStatuses[number]
export const testStatusLabels: Record<TestStatus, string> = {
  failed: 'Failed', blocked: 'Blocked', not_run: 'Not run', running: 'Reported running', passed: 'Passed',
}
export type TestEvent = {
  id: string; event_type?: string; producer?: string; producer_sequence?: number; sequence: number;
  captured_at?: string; received_at: string; data?: unknown;
}
export type ReportedTest<T extends TestEvent> = { event: T; testId: string; name: string; status: TestStatus; detail?: string }

// This is a presentation contract for explicitly reported test receipts. Generic
// journal text, artifacts and agent prose never establish a test outcome.
export function reportedTests<T extends TestEvent>(events: T[]): ReportedTest<T>[] {
  const latest = new Map<string, ReportedTest<T>>()
  for (const event of events) {
    if (event.event_type !== 'test_result' || !event.producer || !Number.isInteger(event.producer_sequence)) continue
    const value = event.data
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const data = value as Record<string, unknown>
    if (typeof data.test_id !== 'string' || !data.test_id.trim() || typeof data.name !== 'string' || !data.name.trim()) continue
    if (!testStatuses.includes(data.status as TestStatus)) continue
    const key = JSON.stringify([event.producer, data.test_id])
    const previous = latest.get(key)
    // Producer ordering prevents a late-arriving start from replacing a result.
    if (previous && (previous.event.producer_sequence! > event.producer_sequence! ||
      (previous.event.producer_sequence === event.producer_sequence && previous.event.sequence > event.sequence))) continue
    latest.set(key, { event, testId: data.test_id, name: data.name, status: data.status as TestStatus, detail: typeof data.detail === 'string' ? data.detail : undefined })
  }
  return [...latest.values()].sort((a, b) => testStatuses.indexOf(a.status) - testStatuses.indexOf(b.status) || a.name.localeCompare(b.name))
}
