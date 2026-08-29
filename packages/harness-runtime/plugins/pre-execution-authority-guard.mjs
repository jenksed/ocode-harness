import {
  decidePreExecutionAuthority,
  formatPreExecutionAuthorityError,
} from '../lib/pre-execution-authority-guard.mjs';

async function roleFromSession(plugin, sessionID) {
  const response = await plugin.client.session.messages({
    path: { id: sessionID },
    query: { directory: plugin.directory },
  });
  const messages = response.data ?? [];
  return [...messages].reverse().find((message) => message.info?.role === 'user')?.info?.agent ?? null;
}

/**
 * Constitutional deny-only barrier. OpenCode keeps sole ownership of ASK and
 * permission replies; this plugin only throws before prohibited Bash executes.
 */
export default async function preExecutionAuthorityGuard(plugin, options = {}) {
  const agentBySession = new Map();
  return {
    'chat.message': async (input) => {
      if (typeof input.agent === 'string' && input.agent) agentBySession.set(input.sessionID, input.agent);
    },
    'tool.execute.before': async (input, output) => {
      if (input.tool !== 'bash') return;
      let role = agentBySession.get(input.sessionID) ?? null;
      let lookupFailed = false;
      if (!role) {
        try { role = await roleFromSession(plugin, input.sessionID); } catch { lookupFailed = true; }
      }
      const command = output.args?.command;
      const decision = decidePreExecutionAuthority({
        command,
        role: lookupFailed ? null : role,
        authorityByRole: options.authorityByRole,
      });
      if (decision.decision === 'DENY') throw new Error(formatPreExecutionAuthorityError(decision));
    },
  };
}
