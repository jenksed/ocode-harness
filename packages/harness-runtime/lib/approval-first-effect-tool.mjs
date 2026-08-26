import { createInterface } from 'node:readline/promises';
import { executeApprovalFirstEffect } from './approval-first-effect-execution.mjs';

/** Build the pinned OpenCode v1 custom-tool definition. */
export function createApprovalFirstEffectTool(tool, pluginContext = {}) {
  return tool({
    description: 'Request one bounded operation through Ocode authority. Approval never changes role authority.',
    args: {
      operation: tool.schema.string().min(1),
      reason: tool.schema.string().optional(),
    },
    async execute(input, toolContext = {}) {
      const operation = input?.operation;
      const projectDir = toolContext.directory || toolContext.worktree || pluginContext.directory || pluginContext.worktree || process.cwd();
      const requester = toolContext.agent || pluginContext.agent?.name || pluginContext.agent?.id || 'semantic-agent';
      const sessionId = toolContext.sessionID || pluginContext.sessionID || pluginContext.sessionId || null;
      const rl = process.stdin.isTTY && process.stdout.isTTY
        ? createInterface({ input: process.stdin, output: process.stdout }) : null;
      try {
        const result = await executeApprovalFirstEffect({
          command: operation,
          projectDir,
          requester,
          sessionId,
          reason: input?.reason ?? null,
          evidencePath: `${projectDir}/.opencode/approval-ledger.jsonl`,
          resolver: async (request) => {
            if (!rl) return 'REJECT';
            const answer = (await rl.question(`Approval required (${request.classification.kind}): ${operation}\nAllow once? [y/N] `)).trim().toLowerCase();
            return answer === 'y' || answer === 'yes' ? 'ALLOW_ONCE' : 'REJECT';
          },
        });
        return {
          title: `Governed effect: ${result.status}`,
          output: JSON.stringify(result),
          metadata: {
            approval_first: true,
            request_id: result.request_id,
            session_id: result.session_id,
            status: result.status,
          },
        };
      } finally {
        rl?.close();
      }
    },
  });
}
