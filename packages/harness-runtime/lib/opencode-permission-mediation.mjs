export const APPROVAL_DECISIONS = Object.freeze({ ALLOW_ONCE: 'ALLOW_ONCE', REJECT: 'REJECT' });

export function normalizeOpenCodePermissionRequest(event) {
  const request = event?.properties ?? event?.data;
  if (event?.type !== 'permission.updated' || !request?.id || !request?.sessionID) return null;
  return {
    runtime_request_id: request.id, session_id: request.sessionID,
    message_id: request.messageID ?? null, call_id: request.callID ?? null,
    permission: request.type ?? null, pattern: request.pattern ?? null,
    title: request.title ?? null, metadata: request.metadata ?? null, raw: structuredClone(request),
  };
}

export async function mediateOpenCodePermission({ event, sessionID, reply, resolver, handled = new Set() }) {
  const request = normalizeOpenCodePermissionRequest(event);
  if (!request || request.session_id !== sessionID) return { status: 'IGNORED' };
  if (handled.has(request.runtime_request_id)) return { status: 'DUPLICATE', request };
  handled.add(request.runtime_request_id);
  if (typeof resolver !== 'function') throw new Error('APPROVAL_REQUIRED');
  const decision = await resolver(request);
  const response = decision === APPROVAL_DECISIONS.ALLOW_ONCE ? 'once' : decision === APPROVAL_DECISIONS.REJECT ? 'reject' : null;
  if (!response) throw new Error('APPROVAL_DECISION_INVALID');
  await reply({ request, response });
  return { status: 'MEDIATED', request, decision };
}
