import { tool } from '@opencode-ai/plugin/tool';

async function invoke(options, path, body) {
  const response = await fetch(`${options.endpoint}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ocode-verification-capability': options.capability },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'OCODE_VERIFICATION_ENVIRONMENT_REJECTED');
  return payload;
}

/**
 * Intent surface only. The server plugin never invokes Git: the per-run parent
 * runtime owns request construction, grant validation, and worktree execution.
 */
export default async function verificationEnvironmentTool(_plugin, options = {}) {
  if (typeof options.endpoint !== 'string' || typeof options.capability !== 'string') throw new Error('OCODE_VERIFICATION_ENDPOINT_UNAVAILABLE');
  return {
    tool: {
      verification_environment: tool({
        description: 'Request an Ocode-managed clean detached verification environment for one exact revision.',
        args: {
          revision: tool.schema.string().min(1),
          work_scope: tool.schema.string().min(1),
        },
        async execute(args, context) {
          const requested = await invoke(options, '/request', { revision: args.revision, work_scope: args.work_scope, session_id: context.sessionID, message_id: context.messageID, agent: context.agent });
          await context.ask({ permission: 'verification_environment', patterns: [requested.request_id], always: [], metadata: { request_id: requested.request_id, work_scope: args.work_scope } });
          const completed = await invoke(options, '/continue', { request_id: requested.request_id, session_id: context.sessionID, message_id: context.messageID });
          return { title: 'Ocode verification environment', output: completed.environment.path, metadata: { request_id: requested.request_id, receipt_id: completed.receipt.receipt_id, worktree_id: completed.environment.worktree_id } };
        },
      }),
    },
  };
}
