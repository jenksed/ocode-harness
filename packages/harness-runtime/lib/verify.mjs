import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolveRuntimeState, worktreeRoot } from './runtime-state.mjs';
import {
  createActivityExecutionContext,
  finishActivityExecution,
  startActivityExecution,
} from './activity.mjs';

const MAX_OUTPUT_BYTES = 10240; // 10KB bound

const VALIDATION_CATEGORIES = ['test', 'build', 'lint', 'typecheck', 'verify'];

function parseOrientation(orientationPath) {
  try {
    const content = readFileSync(orientationPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

function extractCommands(orientation, explicitCommands = {}) {
  const commands = {};
  
  // Start with orientation commands if available
  if (orientation?.commands) {
    for (const category of VALIDATION_CATEGORIES) {
      if (orientation.commands[category] && orientation.commands[category].length > 0) {
        commands[category] = [...orientation.commands[category]];
      }
    }
  }
  
  // Override with explicit commands
  for (const category of VALIDATION_CATEGORIES) {
    if (explicitCommands[category] && explicitCommands[category].length > 0) {
      commands[category] = [...explicitCommands[category]];
    }
  }
  
  return commands;
}

function splitCommand(cmd) {
  // Simple shell-like split - handles basic quoting
  const parts = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  
  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    const nextChar = cmd[i + 1];
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '\\' && (inSingleQuote || inDoubleQuote) && nextChar) {
      // Handle escaped quotes inside quotes
      current += nextChar;
      i++;
    } else if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current.length > 0) {
    parts.push(current);
  }
  
  return parts;
}

function boundOutput(output, maxBytes = MAX_OUTPUT_BYTES) {
  if (!output) return '';
  const str = String(output);
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  
  // Truncate to maxBytes, trying to preserve line boundaries
  const bytes = Buffer.from(str, 'utf8');
  const truncated = bytes.subarray(0, maxBytes);
  let result = truncated.toString('utf8');
  
  // Try to end at a line boundary
  const lastNewline = result.lastIndexOf('\n');
  if (lastNewline > maxBytes * 0.5) {
    result = result.substring(0, lastNewline);
  }
  
  return result + '\n... [output truncated]';
}

function extractFailingTests(output) {
  if (!output) return [];
  
  const failingTests = [];
  const lines = output.split('\n');
  
  // Common test failure patterns
  const patterns = [
    // Jest/Vitest: "● Test Name" or "FAIL test/file.test.js"
    /^\s*[●✕✗]\s+(.+)$/,
    // Mocha: "1) Test Name"
    /^\s*\d+\)\s+(.+)$/,
    // Go test: "--- FAIL: TestName"
    /^--- FAIL:\s+(\S+)/,
    // Python pytest: "FAILED test_module.py::test_name"
    /^FAILED\s+(\S+)/,
    // Generic: lines containing "FAIL" or "Error:" near test names
    /(?:FAIL|Error:)\s+(.+)$/
  ];
  
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const testName = match[1].trim();
        if (testName.length > 0 && testName.length < 200) {
          failingTests.push(testName);
        }
        break; // Only match first pattern per line
      }
    }
  }
  
  // Deduplicate
  return [...new Set(failingTests)].slice(0, 20); // Cap at 20
}

function executeCommand(command, cwd, timeout = 120000) {
  const parts = splitCommand(command);
  if (parts.length === 0) {
    throw new Error('Empty command');
  }
  
  const [bin, ...args] = parts;
  const startTime = Date.now();
  
  try {
    const output = execFileSync(bin, args, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES * 2, // Allow slightly more for capture before bounding
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    const durationMs = Date.now() - startTime;
    return {
      exit_code: 0,
      result: 'PASS',
      output: boundOutput(output),
      duration_ms: durationMs,
      failing_tests: []
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    
    // Distinguish timeout (infrastructure) from command failure
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
      return {
        exit_code: null,
        result: 'INFRASTRUCTURE_FAILURE',
        output: boundOutput(err.stdout || err.stderr || `Command timed out after ${timeout}ms`),
        duration_ms: durationMs,
        failing_tests: [],
        infrastructure_error: 'TIMEOUT'
      };
    }
    
    // Command failed - this is a validation failure, not infrastructure
    const stdout = err.stdout ? boundOutput(err.stdout) : '';
    const stderr = err.stderr ? boundOutput(err.stderr) : '';
    const combinedOutput = [stdout, stderr].filter(Boolean).join('\n');
    
    return {
      exit_code: err.status ?? 1,
      result: 'FAIL',
      output: combinedOutput,
      duration_ms: durationMs,
      failing_tests: extractFailingTests(combinedOutput)
    };
  }
}

function findProjectRoot(startDir) {
  return worktreeRoot(startDir);
}

function findOrientationFile(projectRoot, environment) {
  return resolveRuntimeState(projectRoot, { environment }).orientation_json;
}

/**
 * Run deterministic validation commands.
 * @param {Object} options
 * @param {string} [options.projectRoot] - Project root directory (defaults to cwd)
 * @param {Object} [options.explicitCommands] - Explicit commands to override orientation
 * @param {string[]} [options.explicitCommands.test]
 * @param {string[]} [options.explicitCommands.build]
 * @param {string[]} [options.explicitCommands.lint]
 * @param {string[]} [options.explicitCommands.typecheck]
 * @param {string[]} [options.explicitCommands.verify]
 * @param {number} [options.timeout] - Per-command timeout in ms (default 120000)
 * @returns {Object} Structured verification result
 */
export function runVerification(options = {}) {
  const { projectRoot: providedRoot, explicitCommands = {}, timeout = 120000, env = process.env } = options;
  
  // Determine project root
  const projectRoot = providedRoot ? resolve(providedRoot) : findProjectRoot(process.cwd());
  
  // Find and parse orientation
  const orientationPath = findOrientationFile(projectRoot, env);
  const orientation = parseOrientation(orientationPath);
  
  // Extract commands (orientation + explicit overrides)
  const commands = extractCommands(orientation, explicitCommands);
  
  // Check if we have any commands to run
  const hasCommands = VALIDATION_CATEGORIES.some(cat => commands[cat] && commands[cat].length > 0);
  if (!hasCommands) {
    throw new Error('No validation commands available. Run orientation first or provide explicit commands via --commands.');
  }

  // This is the deterministic verification seam, not a report extracted from
  // verifier prose. It can join a parent workflow through the supplied IDs.
  const activity = createActivityExecutionContext(options, { projectDir: projectRoot, role: 'verifier' });
  startActivityExecution(activity);
  
  // Execute all commands across all categories
  const results = [];
  let infrastructureFailures = 0;
  
  for (const category of VALIDATION_CATEGORIES) {
    const categoryCommands = commands[category] || [];
    
    for (const cmd of categoryCommands) {
      const result = executeCommand(cmd, projectRoot, timeout);
      result.command = cmd;
      result.category = category;
      results.push(result);
      
      if (result.result === 'INFRASTRUCTURE_FAILURE') {
        infrastructureFailures++;
      }
    }
  }
  
  // Determine overall status
  const hasFailures = results.some(r => r.result === 'FAIL');
  const hasInfrastructureFailures = infrastructureFailures > 0;
  
  let status;
  if (hasInfrastructureFailures && !hasFailures) {
    status = 'INFRASTRUCTURE_FAILURE';
  } else if (hasFailures) {
    status = 'FAIL';
  } else {
    status = 'PASS';
  }
  
  const summary = {
    total: results.length,
    passed: results.filter(r => r.result === 'PASS').length,
    failed: results.filter(r => r.result === 'FAIL').length,
    infrastructure_failures: infrastructureFailures
  };
  
  const verification = {
    status,
    commands: results,
    summary,
    project_root: projectRoot,
    orientation_path: orientationPath,
    timestamp: new Date().toISOString()
  };
  finishActivityExecution(activity, {
    success: status === 'PASS',
    failure_classification: status === 'PASS' ? null : status,
  });
  return verification;
}

/**
 * CLI entry point for verification.
 * @param {Object} options - Parsed CLI options
 * @returns {Promise<void>}
 */
export async function verifyCommand(options) {
  const explicitCommands = {};
  
  // Parse explicit commands from CLI
  for (const category of VALIDATION_CATEGORIES) {
    const optName = category.replace(/([A-Z])/g, '-$1').toLowerCase(); // typecheck -> type-check
    if (options[optName]) {
      explicitCommands[category] = options[optName].split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  
  // Also support --commands json
  if (options.commands) {
    try {
      const parsed = JSON.parse(options.commands);
      for (const category of VALIDATION_CATEGORIES) {
        if (parsed[category]) {
          explicitCommands[category] = Array.isArray(parsed[category]) ? parsed[category] : [parsed[category]];
        }
      }
    } catch (err) {
      console.error('✗ Invalid --commands JSON:', err.message);
      process.exit(1);
    }
  }
  
  try {
    const result = runVerification({
      projectRoot: options.projectRoot,
      explicitCommands,
      timeout: options.timeout ? parseInt(options.timeout, 10) : 120000
    });
    
    // Output structured JSON
    console.log(JSON.stringify(result, null, 2));
    
    // Exit with appropriate code
    if (result.status === 'PASS') {
      process.exit(0);
    } else if (result.status === 'INFRASTRUCTURE_FAILURE') {
      process.exit(2);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('✗ Verification failed:', err.message);
    process.exit(2);
  }
}

export { VALIDATION_CATEGORIES, MAX_OUTPUT_BYTES };
