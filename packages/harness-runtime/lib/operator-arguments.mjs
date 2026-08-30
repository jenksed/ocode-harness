/**
 * Classify every argument accepted by Ocode's interactive entrypoint before
 * any project orientation, runtime qualification, server startup, or attach.
 */
const BOOLEAN = new Map([
  ['--continue', '--continue'], ['-c', '--continue'], ['--fork', '--fork'],
  ['--mini', '--mini'], ['--no-replay', '--no-replay'],
]);
const VALUED = new Map([
  ['--session', '--session'], ['-s', '--session'], ['--replay-limit', '--replay-limit'],
  ['--password', '--password'], ['-p', '--password'], ['--username', '--username'], ['-u', '--username'],
]);
const OWNED_OR_UNSUPPORTED = new Set([
  '--agent', '--model', '--dir', '--server', '--port', '--config', '--profile',
  '--help', '-h', '--version', '-V', 'serve', 'attach', 'run',
]);

function rejected(token, reason) {
  const error = new Error(`OCODE_ARGUMENT_UNSUPPORTED: ${token}; ${reason}`);
  error.code = 'OCODE_ARGUMENT_UNSUPPORTED';
  throw error;
}

export function classifyInteractiveArguments(args = []) {
  const forward = [];
  const classifications = [];
  let projectSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--') rejected(token, 'positional passthrough is not supported by the daily-driver entrypoint');
    const [flag, inline] = token.startsWith('--') ? token.split(/=(.*)/s, 2) : [token, undefined];
    if (BOOLEAN.has(flag)) {
      if (inline !== undefined) rejected(token, 'boolean option does not take a value');
      const canonical = BOOLEAN.get(flag);
      classifications.push({ input: token, classification: flag === canonical ? 'SUPPORTED_FORWARD' : 'SUPPORTED_TRANSLATION', output: canonical });
      forward.push(canonical);
      continue;
    }
    if (VALUED.has(flag)) {
      const value = inline !== undefined ? inline : args[++index];
      if (value === undefined || value === '' || value.startsWith('-')) rejected(token, `${flag} requires a non-option value`);
      const canonical = VALUED.get(flag);
      classifications.push({ input: token, classification: flag === canonical ? 'SUPPORTED_FORWARD' : 'SUPPORTED_TRANSLATION', output: [canonical, value] });
      forward.push(canonical, value);
      continue;
    }
    if (token.startsWith('-') || OWNED_OR_UNSUPPORTED.has(token)) {
      rejected(token, OWNED_OR_UNSUPPORTED.has(flag) ? 'this OpenCode launch capability is owned or intentionally unsupported by Ocode' : 'unknown option');
    }
    if (!projectSeen && (token === '.' || !token.startsWith('-'))) {
      projectSeen = true;
      classifications.push({ input: token, classification: 'SUPPORTED_TRANSLATION', output: '--dir <oriented-project>' });
      continue;
    }
    rejected(token, 'unexpected positional argument');
  }
  return Object.freeze({ forward: Object.freeze(forward), classifications: Object.freeze(classifications) });
}
