import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import { createNativeBashPermissionRules } from '../packages/harness-runtime/lib/command-admission.mjs';

const runtimeVersion = '1.18.21';
const root = resolve('.');
const artifactPath = resolve(process.env.OCODE_PERMISSION_EVIDENCE || 'qualification/opencode-1.18.21-permissions.json');

function responseData(response, label) {
  if (response?.error) throw new Error(`${label}:${JSON.stringify(response.error)}`);
  return response?.data;
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen(server.address().port));
  });
}

function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}

function toolChunks(command, callID) {
  return [
    { id: `response-${callID}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: callID, type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command, description: 'Controlled permission fixture' }) } }] }, finish_reason: null }] },
    { id: `response-${callID}`, object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
}

function finalChunks() {
  return [
    { id: 'response-final', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: 'fixture complete' }, finish_reason: null }] },
    { id: 'response-final', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ];
}

async function startMockProvider(commands) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const body = [];
    for await (const chunk of req) body.push(chunk);
    const parsed = JSON.parse(Buffer.concat(body).toString('utf8'));
    requests.push(parsed);
    const completedTools = parsed.messages?.filter((message) => message.role === 'tool').length ?? 0;
    sse(res, completedTools >= commands.length ? finalChunks() : toolChunks(commands[completedTools], `call-${completedTools + 1}`));
  });
  const port = await listen(server);
  return { server, requests, baseURL: `http://127.0.0.1:${port}/v1` };
}

function withEnvironment(environment, start) {
  const previous = new Map(Object.keys(environment).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  return Promise.resolve().then(start).finally(() => {
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  });
}

function initializeGitFixture(fixture) {
  const git = (args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' });
  git(['init']); git(['config', 'user.email', 'fixture@example.test']); git(['config', 'user.name', 'Permission Fixture']);
  git(['add', '--', '.']); git(['commit', '-m', 'fixture']); git(['branch', '-M', 'main']);
}

async function runScenario({ id, command, commands = [command], rules, reply = null, files = {}, git = false }) {
  const fixture = mkdtempSync(join(tmpdir(), `ocode-permission-${id}-`));
  for (const [path, content] of Object.entries(files)) writeFileSync(join(fixture, path), content);
  if (git) initializeGitFixture(fixture);
  const xdg = join(fixture, '.xdg');
  for (const name of ['config', 'data', 'state', 'cache']) mkdirSync(join(xdg, name), { recursive: true });
  const provider = await startMockProvider(commands);
  const config = {
    provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'Permission Fixture', options: { baseURL: provider.baseURL, apiKey: 'fixture-key' }, models: { fixture: { name: 'Fixture' } } } },
    agent: { probe: { mode: 'primary', model: 'fixture/fixture', permission: { bash: rules } } },
  };
  const environment = {
    XDG_CONFIG_HOME: join(xdg, 'config'), XDG_DATA_HOME: join(xdg, 'data'), XDG_STATE_HOME: join(xdg, 'state'), XDG_CACHE_HOME: join(xdg, 'cache'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
  };
  let opencode;
  const events = [];
  let permissionReply = null;
  try {
    opencode = await withEnvironment(environment, () => createOpencodeServer({ hostname: '127.0.0.1', port: 0, timeout: 15_000, config }));
    const client = createOpencodeClient({ baseUrl: opencode.url, directory: fixture });
    const abort = new AbortController();
    const subscription = await client.event.subscribe({ query: { directory: fixture }, signal: abort.signal });
    const created = responseData(await client.session.create({ query: { directory: fixture }, body: { title: id } }), 'SESSION_CREATE');
    let resolveIdle;
    let rejectIdle;
    const idle = new Promise((resolvePromise, rejectPromise) => { resolveIdle = resolvePromise; rejectIdle = rejectPromise; });
    void (async () => {
      try {
        for await (const event of subscription.stream) {
          events.push(structuredClone(event));
          const properties = event.properties ?? {};
          if ((event.type === 'permission.updated' || event.type === 'permission.asked') && properties.sessionID === created.id && reply) {
            permissionReply = { id: properties.id, response: reply, pattern: properties.pattern ?? null, metadata: properties.metadata ?? null };
            await client.postSessionIdPermissionsPermissionId({ path: { id: created.id, permissionID: properties.id }, query: { directory: fixture }, body: { response: reply } });
          }
          if ((event.type === 'session.idle' || event.type === 'session.status' && properties.sessionID === created.id && properties.status?.type === 'idle') && properties.sessionID === created.id) resolveIdle();
          if (event.type === 'session.error' && properties.sessionID === created.id) rejectIdle(new Error(`SESSION_ERROR:${JSON.stringify(properties.error)}`));
        }
      } catch (error) { if (!abort.signal.aborted) rejectIdle(error); }
    })();
    responseData(await client.session.promptAsync({ path: { id: created.id }, query: { directory: fixture }, body: { model: { providerID: 'fixture', modelID: 'fixture' }, agent: 'probe', parts: [{ type: 'text', text: 'Run the fixture command.' }] } }), 'PROMPT');
    // The local SDK/server fixture has startup overhead and serializes native
    // tool rounds. Scale for the full admitted-command matrix rather than
    // declaring a correct runtime unavailable after an arbitrary short limit.
    const scenarioTimeout = Math.max(20_000, commands.length * 20_000);
    await Promise.race([idle, new Promise((_, reject) => setTimeout(() => reject(new Error('SCENARIO_TIMEOUT')), scenarioTimeout))]);
    responseData(await client.session.abort({ path: { id: created.id }, query: { directory: fixture } }), 'SESSION_ABORT');
    abort.abort();
    const permissionEvents = events.filter((event) => event.type === 'permission.updated' || event.type === 'permission.asked');
    const toolParts = events.filter((event) => event.type === 'message.part.updated' && event.properties?.part?.type === 'tool').map((event) => event.properties.part);
    return { id, commands, rules, reply, git_fixture: git, permission_request_count: permissionEvents.length, permission_reply: permissionReply, tool_states: toolParts.map((part) => part.state?.status).filter(Boolean), request_count: provider.requests.length, marker_created: existsSync(join(fixture, 'marker.txt')), session_abort: 'SUPPORTED' };
  } finally {
    await opencode?.close?.();
    await new Promise((resolveClose) => provider.server.close(resolveClose));
  }
}

const scenarios = [];
const requestedScenarios = new Set((process.env.OCODE_PERMISSION_SCENARIOS || '').split(',').filter(Boolean));
const { contracts } = loadAgentContracts({ baseDir: root });
const orchestrator = contracts.get('orchestrator');
const orchestratorRules = createNativeBashPermissionRules({
  baseRules: orchestrator.permissions.bash,
  roleAuthority: orchestrator.authority,
});
for (const scenario of [
  { id: 'exact-allow', command: 'pwd', rules: { '*': 'ask', pwd: 'allow' } },
  { id: 'no-match-default', command: 'pwd', rules: { 'git status': 'allow' } },
  { id: 'explicit-no-match-ask', command: 'pwd', rules: { '*': 'ask', 'git status': 'allow' }, reply: 'once' },
  { id: 'wildcard-allow', command: 'pwd -P', rules: { '*': 'ask', 'pwd *': 'allow' } },
  { id: 'conflict-last-allow', command: 'pwd', rules: { pwd: 'deny', '*': 'allow' } },
  { id: 'conflict-last-deny', command: 'pwd', rules: { '*': 'allow', pwd: 'deny' } },
  { id: 'composition-and', command: 'pwd && printf composed', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'composition-or', command: 'false || pwd', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'composition-pipe', command: 'pwd | wc -c', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'composition-redirection', command: 'pwd > marker.txt', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'composition-substitution', command: 'printf $(pwd)', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'composition-backticks', command: 'printf `pwd`', rules: { '*': 'ask', pwd: 'allow' }, reply: 'reject' },
  { id: 'wildcard-composition-and', command: 'pwd -P && printf composed', rules: { '*': 'ask', 'pwd *': 'allow' }, reply: 'reject' },
  { id: 'wildcard-composition-redirection', command: 'pwd -P > marker.txt', rules: { '*': 'ask', 'pwd *': 'allow' }, reply: 'reject' },
  { id: 'wildcard-redirection-denied', command: 'pwd -P > marker.txt', rules: { '*': 'ask', 'pwd *': 'allow', '*>*': 'deny' } },
  { id: 'reply-once-scope', commands: ['pwd', 'pwd'], rules: { '*': 'ask' }, reply: 'once' },
  { id: 'reply-always-scope', commands: ['pwd', 'pwd'], rules: { '*': 'ask' }, reply: 'always' },
  { id: 'reply-reject', command: 'pwd', rules: { '*': 'ask' }, reply: 'reject' },
  { id: 'admitted-validation', command: 'npm test', rules: { '*': 'ask', 'npm test': 'allow', '*>*': 'deny', '*<*': 'deny' }, files: { 'package.json': '{"scripts":{"test":"node -e \\"process.exit(0)\\""}}' } },
  { id: 'remote-deny', command: 'git push origin fixture', rules: { '*': 'ask', 'git push *': 'deny' } },
  { id: 'low-interruption-loop', commands: ['pwd', 'rg needle fixture.txt', 'npm test', 'npm test'], rules: { '*': 'ask', pwd: 'allow', 'rg *': 'allow', 'npm test': 'allow', '*>*': 'deny', '*<*': 'deny' }, files: { 'fixture.txt': 'needle\n', 'package.json': '{"scripts":{"test":"node -e \\"process.exit(0)\\""}}' } },
  {
    id: 'orchestrator-safe-observation',
    commands: ['pwd', 'ls', 'ls -la', 'rg needle fixture.txt', 'grep needle fixture.txt', 'find . -maxdepth 1', 'head fixture.txt', 'tail fixture.txt', 'wc fixture.txt', 'file fixture.txt', 'stat fixture.txt', 'tree .', 'which git', 'command -v git', 'git status --short', 'git diff', 'git log --oneline -5', 'git show HEAD:README.md', 'git rev-parse HEAD', 'git branch --show-current', 'git branch --list', 'git worktree list'],
    rules: orchestratorRules,
    git: true,
    files: { 'README.md': '# fixture\n', 'fixture.txt': 'needle\n' },
  },
  {
    id: 'orchestrator-mutation-denied',
    commands: ['git add README.md', 'git commit -m denied', 'git switch denied', 'git restore README.md', 'git push origin main', 'echo x > marker.txt', 'rg needle fixture.txt > marker.txt'],
    rules: orchestratorRules,
    git: true,
    files: { 'README.md': '# fixture\n', 'fixture.txt': 'needle\n' },
  },
  { id: 'orchestrator-git-add-denied', command: 'git add README.md', rules: orchestratorRules, git: true, files: { 'README.md': '# fixture\n' } },
  { id: 'orchestrator-git-status-observation', command: 'git status --short', rules: orchestratorRules, git: true, files: { 'README.md': '# fixture\n' } },
]) {
  if (!requestedScenarios.size || requestedScenarios.has(scenario.id)) scenarios.push(await runScenario(scenario));
}

const baseEvidencePath = process.env.OCODE_PERMISSION_BASE_EVIDENCE ? resolve(process.env.OCODE_PERMISSION_BASE_EVIDENCE) : null;
const baseEvidence = baseEvidencePath && existsSync(baseEvidencePath) ? JSON.parse(readFileSync(baseEvidencePath, 'utf8')) : null;
const mergedScenarios = baseEvidence
  ? [...baseEvidence.scenarios.filter((entry) => !scenarios.some((next) => next.id === entry.id)), ...scenarios]
  : scenarios;
const artifact = { schema_version: 1, runtime: { opencode: runtimeVersion, sdk: runtimeVersion }, observed_at: new Date().toISOString(), method: 'local OpenAI-compatible non-inference fixture through installed SDK/server', lifecycle: { server_start: 'SUPPORTED', sdk_endpoint: 'SUPPORTED', session_create: 'SUPPORTED', event_subscribe: 'SUPPORTED', prompt_submit: 'SUPPORTED', session_completion: 'SUPPORTED', session_abort: 'SUPPORTED', clean_shutdown: 'SUPPORTED' }, scenarios: mergedScenarios };
mkdirSync(resolve('qualification'), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({ status: 'OPENCODE_PERMISSION_CHARACTERIZATION_RECORDED', artifact: artifactPath, scenarios: scenarios.map(({ id, permission_request_count, tool_states }) => ({ id, permission_request_count, tool_states })) }));
