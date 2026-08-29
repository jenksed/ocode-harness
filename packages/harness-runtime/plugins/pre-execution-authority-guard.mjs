import { decidePreExecutionAuthority, formatPreExecutionAuthorityError } from '../lib/pre-execution-authority-guard.mjs';

async function roleFromSession(plugin, sessionID) {
  const response = await plugin.client.session.messages({ path: { id: sessionID }, query: { directory: plugin.directory } });
  const messages = response.data ?? [];
  return [...messages].reverse().find((message) => message.info?.role === 'user')?.info?.agent ?? null;
}

/** OpenCode remains the sole ASK owner; this plugin only rejects before Bash. */
export default async function preExecutionAuthorityGuard(plugin, options = {}) {
  const agentBySession = new Map();
  return {
    'chat.message': async (input) => {
      if (typeof input.agent === 'string' && input.agent) agentBySession.set(input.sessionID, input.agent);
    },
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash') return;
      let role = agentBySession.get(input.sessionID) ?? null;
      if (!role) {
        try { role = await roleFromSession(plugin, input.sessionID); } catch { role = null; }
      }
      const decision = decidePreExecutionAuthority({ command: output.args?.command, role, authorityByRole: options.authorityByRole });
      if (decision.decision === 'DENY') throw new Error(formatPreExecutionAuthorityError(decision));
    },
  };
}
