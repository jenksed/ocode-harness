import { appendFile } from 'node:fs/promises';

function record(path, event) { return appendFile(path, `${JSON.stringify(event)}\n`, 'utf8'); }

/** Fixture-only hook proves pinned OpenCode ordering and role visibility. */
export default async function preExecutionQualificationPlugin(plugin, options = {}) {
  const agents = new Map();
  async function roleFromSession(sessionID) {
    const response = await plugin.client.session.messages({ path: { id: sessionID }, query: { directory: plugin.directory } });
    const messages = response.data ?? [];
    return [...messages].reverse().find((message) => message.info?.role === 'user')?.info?.agent ?? null;
  }
  return {
    'chat.message': async (input) => {
      agents.set(input.sessionID, input.agent ?? null);
      await record(options.logPath, { event: 'chat.message', sessionID: input.sessionID, agent: input.agent ?? null });
    },
    'tool.execute.before': async (input, output) => {
      await record(options.logPath, {
        event: 'before', tool: input.tool, sessionID: input.sessionID, callID: input.callID,
        command: output.args?.command ?? null, agent_from_chat_message: agents.get(input.sessionID) ?? null,
        agent_from_session_messages: await roleFromSession(input.sessionID),
      });
      if (output.args?.command === options.denyCommand) throw new Error('OCODE_QUALIFICATION_PRE_EXECUTION_DENY');
    },
  };
}
