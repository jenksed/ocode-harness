import { appendFile } from 'node:fs/promises';

function record(logPath, event) {
  return appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8');
}

export default async function preExecutionQualificationPlugin(plugin, options = {}) {
  const logPath = options.logPath;
  const denyCommand = options.denyCommand;
  const agents = new Map();
  async function resolveAgent(sessionID) {
    try {
      const response = await plugin.client.session.messages({
        path: { id: sessionID },
        query: { directory: plugin.directory },
      });
      const messages = response.data ?? [];
      return [...messages].reverse().find((message) => message.info?.role === 'user')?.info?.agent ?? null;
    } catch (error) {
      return `ERROR:${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return {
    'chat.message': async (input) => {
      agents.set(input.sessionID, input.agent ?? null);
      await record(logPath, {
        event: 'chat.message',
        sessionID: input.sessionID,
        agent: input.agent ?? null,
      });
    },
    'tool.execute.before': async (input, output) => {
      await record(logPath, {
        event: 'before',
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
        command: output.args?.command ?? null,
        agent_from_chat_message: agents.get(input.sessionID) ?? null,
        agent_from_session_messages: await resolveAgent(input.sessionID),
      });
      if (output.args?.command === denyCommand) throw new Error('OCODE_QUALIFICATION_PRE_EXECUTION_DENY');
    },
    'tool.execute.after': async (input) => {
      await record(logPath, {
        event: 'after',
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
      });
    },
  };
}
