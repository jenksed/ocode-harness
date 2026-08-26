import { createInterface } from 'node:readline/promises';
import { executeApprovalFirstEffect } from '../packages/harness-runtime/lib/approval-first-effect-execution.mjs';

// OpenCode plugin contract: the model supplies only the requested operation;
// Ocode binds requester/session/project context from the host invocation.
export default async function approvalFirstEffectPlugin(context = {}) {
  return {
    tool: {
      request_effect: {
        description: 'Request one bounded operation through Ocode authority. Approval never changes role authority.',
        input: {
          type: 'object', required: ['operation'], additionalProperties: false,
          properties: { operation: { type: 'string', minLength: 1 }, reason: { type: 'string' } },
        },
        async execute(input) {
          const operation = input?.operation;
          const projectDir = context.directory || context.worktree || process.cwd();
          const requester = context.agent?.name || context.agent?.id || 'semantic-agent';
          const sessionId = context.sessionID || context.sessionId || null;
          const rl = process.stdin.isTTY && process.stdout.isTTY
            ? createInterface({ input: process.stdin, output: process.stdout }) : null;
          try {
            return await executeApprovalFirstEffect({
              command: operation, projectDir, requester,
              sessionId, reason: input?.reason ?? null,
              evidencePath: `${projectDir}/.opencode/approval-ledger.jsonl`,
              resolver: async (request) => {
                if (!rl) return 'REJECT';
                const answer = (await rl.question(`Approval required (${request.classification.kind}): ${operation}\nAllow once? [y/N] `)).trim().toLowerCase();
                return answer === 'y' || answer === 'yes' ? 'ALLOW_ONCE' : 'REJECT';
              },
            });
          } finally { rl?.close(); }
        },
      },
    },
  };
}
