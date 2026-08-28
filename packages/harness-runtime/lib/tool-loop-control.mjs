export const TOOL_LOOP_SCHEMA_VERSION = 1;
/** Detects lack of state progress; it is telemetry-first and does not silently terminate OpenCode sessions. */
export function evaluateToolLoop(events, { max_repeated_without_progress = 2 } = {}) {
  if (!Array.isArray(events) || !Number.isInteger(max_repeated_without_progress) || max_repeated_without_progress < 1) throw new Error('Tool-loop inputs invalid');
  let previous = null, repeats = 0;
  for (const event of events) {
    if (!event || typeof event !== 'object') throw new Error('Tool-loop event invalid');
    if (event.state_progress === true) { previous = null; repeats = 0; continue; }
    const identity = typeof event.command === 'string' ? event.command : event.tool === 'read' ? `read:${event.path || ''}` : null;
    if (!identity) continue;
    repeats = identity === previous ? repeats + 1 : 1;
    previous = identity;
    if (repeats > max_repeated_without_progress) return { schema_version: TOOL_LOOP_SCHEMA_VERSION, status: 'NO_PROGRESS_DETECTED', repeated_identity: identity, repeat_count: repeats, action: 'REPORT_BLOCKED_OR_UPDATE_HYPOTHESIS' };
  }
  return { schema_version: TOOL_LOOP_SCHEMA_VERSION, status: 'CONFORMING', action: 'CONTINUE' };
}
