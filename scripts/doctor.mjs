#!/usr/bin/env node
/**
 * doctor.mjs
 * ocode-harness doctor command
 */

import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
  CONFIG as DEPLOY_CONFIG,
  readMachineConfig,
  getFreellmapiBaseUrl,
  findSourceRepo,
} from '../packages/harness-runtime/lib/deploy.mjs';
import {
  buildOpenCodeRuntimeOverlay,
  fingerprintBindingProfile,
  loadBindingProfile,
  serializeOpenCodeRuntimeOverlay,
} from '../packages/harness-runtime/lib/opencode-integration.mjs';
import { loadAgentContracts } from '../packages/harness-runtime/lib/agent-contract.mjs';
import {
  CAPABILITY_SCHEMA_VERSION,
  fingerprintCapabilityVocabulary,
  validateCapabilityVocabulary,
} from '../packages/harness-runtime/lib/governance.mjs';
import { evaluateContractAdmission } from '../packages/harness-runtime/lib/admission.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
  agentsDir: join(homedir(), '.config', 'opencode', 'agents'),
  orientationDir: DEPLOY_CONFIG.orientationDir,
  harnessRoot: DEPLOY_CONFIG.currentRelease,
  harnessRuntimeDir: DEPLOY_CONFIG.harnessRuntimeDir,
  opencodeConfig: join(homedir(), '.config', 'opencode', 'opencode.json'),
  machineConfig: DEPLOY_CONFIG.machineConfig,
};

const KNOWN_GOOD_OPENCODE_VERSION = '1.18.21';

function printSection(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(title);
  console.log('='.repeat(60));
}

function checkOpencode() {
  printSection('Checking opencode...');

  try {
    const opencodePath = execSync('which opencode', { encoding: 'utf8' }).trim();
    console.log(`✓ opencode found at: ${opencodePath}`);

    try {
      const opencodeVersion = execSync('opencode --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${opencodeVersion}`);
      if (opencodeVersion === KNOWN_GOOD_OPENCODE_VERSION) {
        console.log('  ✓ Known-good M2 integration version');
      } else {
        console.warn(`  ⚠ Version differs from tested ${KNOWN_GOOD_OPENCODE_VERSION}`);
        console.warn('    Run: npm run acceptance:m2');
      }
    } catch (err) {
      console.error('  ✗ Could not get opencode version');
      return false;
    }

    return true;
  } catch (err) {
    console.error('✗ opencode not found in PATH');
    console.error('  Please install opencode and ensure it is in your PATH');
    return false;
  }
}

function checkOpenCodeBindingOverlay() {
  printSection('Checking OpenCode runtime binding overlay...');

  try {
    const profile = {
      schema_version: 1,
      name: 'doctor',
      policy_version: 1,
      bindings: {
        'ocode-doctor-diagnostic': 'freellmapi/auto:default',
      },
    };
    const overlay = buildOpenCodeRuntimeOverlay(profile);
    const serialized = serializeOpenCodeRuntimeOverlay(profile);
    const expected = {
      agent: {
        'ocode-doctor-diagnostic': {
          model: 'freellmapi/auto:default',
        },
      },
    };

    if (JSON.stringify(overlay) !== JSON.stringify(expected)) {
      console.error('✗ Runtime overlay shape is not the proven agent.<role>.model contract');
      return false;
    }
    if (serialized !== JSON.stringify(expected)) {
      console.error('✗ Runtime overlay serialization is not deterministic');
      return false;
    }

    console.log('✓ Design C overlay builder is structurally healthy');
    console.log('  Mechanism: OPENCODE_CONFIG_CONTENT -> agent.<role>.model');
    return true;
  } catch (err) {
    console.error(`✗ Runtime overlay builder failed: ${err.message}`);
    return false;
  }
}

function checkNode() {
  printSection('Checking Node.js...');

  try {
    const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
    console.log(`✓ Node.js found at: ${nodePath}`);

    try {
      const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${nodeVersion}`);
    } catch (err) {
      console.error('  ✗ Could not get Node.js version');
    }

    return true;
  } catch (err) {
    console.error('✗ Node.js not found in PATH');
    console.error('  Please install Node.js and ensure it is in your PATH');
    return false;
  }
}

function checkGit() {
  printSection('Checking git...');

  try {
    const gitPath = execSync('which git', { encoding: 'utf8' }).trim();
    console.log(`✓ git found at: ${gitPath}`);

    try {
      const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
      console.log(`  Version: ${gitVersion}`);
    } catch (err) {
      console.error('  ✗ Could not get git version');
    }

    return true;
  } catch (err) {
    console.error('✗ git not found in PATH');
    console.error('  Please install git and ensure it is in your PATH');
    return false;
  }
}

function checkAgents() {
  printSection('Checking agents...');

  if (!existsSync(CONFIG.agentsDir)) {
    console.error('✗ Agents directory not found');
    console.error(`  Path: ${CONFIG.agentsDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Agents directory found: ${CONFIG.agentsDir}`);

  const baseDir = findSourceRepo(process.cwd()) || CONFIG.harnessRoot;
  let agentFiles;
  try {
    agentFiles = loadAgentContracts({
      baseDir,
      agentsDir: CONFIG.agentsDir,
      manifestPath: join(baseDir, 'agents', 'manifest.json'),
    }).manifest.roles.map((role) => role.file);
  } catch (err) {
    console.error(`✗ Manifest-derived agent contract validation failed: ${err.message}`);
    return false;
  }

  let allFound = true;
  for (const agentFile of agentFiles) {
    const agentPath = join(CONFIG.agentsDir, agentFile);
    if (existsSync(agentPath)) {
      console.log(`  ✓ ${agentFile}`);
    } else {
      console.error(`  ✗ ${agentFile} not found`);
      allFound = false;
    }
  }

  return allFound;
}

function checkExecutionProfilesAndContracts() {
  printSection('Checking M3 execution profiles and agent contracts...');
  const baseDir = findSourceRepo(process.cwd()) || CONFIG.harnessRoot;
  try {
    const { manifest, contracts } = loadAgentContracts({
      baseDir,
      agentsDir: CONFIG.agentsDir,
      manifestPath: join(baseDir, 'agents', 'manifest.json'),
    });
    const machineConfig = readMachineConfig(CONFIG.machineConfig);
    for (const profileName of ['free', 'hybrid']) {
      const { profile } = loadBindingProfile(profileName, {
        profilesDir: join(baseDir, 'profiles'),
        manifest,
      });
      console.log(`  ✓ ${profileName}: ${fingerprintBindingProfile(profile).slice(0, 12)} (${manifest.roles.length} explicit bindings)`);
      if (profileName === 'free' && Object.values(profile.bindings).some((binding) => binding.startsWith('openai/'))) {
        throw new Error('free profile contains an OpenAI binding');
      }
    }
    if (!['free', 'hybrid'].includes(machineConfig.profile)) {
      throw new Error(`Unknown active machine profile: ${machineConfig.profile}`);
    }
    for (const contract of contracts.values()) {
      if (contract.declared_model !== null) {
        throw new Error(`Canonical agent ${contract.id} contains model policy`);
      }
      if (!/^[0-9a-f]{64}$/.test(contract.contract_fingerprint)) {
        throw new Error(`Canonical agent ${contract.id} fingerprint is invalid`);
      }
    }
    console.log(`✓ Active profile '${machineConfig.profile}' exists and all canonical agents are provider-neutral`);
    console.log('✓ Manifest authority, OpenCode permissions, semantic content, and fingerprints parse deterministically');
    return true;
  } catch (err) {
    console.error(`✗ M3 profile/contract check failed: ${err.message}`);
    return false;
  }
}

function checkGovernanceContracts() {
  printSection('Checking M4 governance contracts...');
  const baseDir = findSourceRepo(process.cwd()) || CONFIG.harnessRoot;
  try {
    const vocabulary = validateCapabilityVocabulary();
    const { manifest, contracts } = loadAgentContracts({
      baseDir,
      agentsDir: CONFIG.agentsDir,
      manifestPath: join(baseDir, 'agents', 'manifest.json'),
    });
    for (const role of manifest.roles) {
      const contract = contracts.get(role.id);
      if (contract.capabilities.schema_version !== CAPABILITY_SCHEMA_VERSION) {
        throw new Error(`Canonical agent ${role.id} has an unsupported capability schema`);
      }
      if (contract.capabilities.provides.length === 0) {
        throw new Error(`Canonical agent ${role.id} has no declared capabilities`);
      }
      const decision = evaluateContractAdmission(contract);
      if (decision.decision !== 'ALLOW' || decision.governance_state !== 'VALID') {
        throw new Error(`Canonical agent ${role.id} baseline governance is invalid: ${decision.reason_codes.join(', ')}`);
      }
    }
    console.log(`  ✓ capability schema v${vocabulary.schema_version}: ${fingerprintCapabilityVocabulary(vocabulary).slice(0, 12)} (${vocabulary.capabilities.length} known capabilities)`);
    console.log(`✓ All ${manifest.roles.length} manifest-governed roles have valid baseline governance through the shared admission engine`);
    console.log('✓ Doctor evaluates configured-permission projection, never effective runtime permission');
    return true;
  } catch (err) {
    console.error(`✗ M4 governance contract check failed: ${err.message}`);
    return false;
  }
}

function checkOrchestratorConfig() {
  printSection('Checking orchestrator configuration...');

  if (!existsSync(CONFIG.opencodeConfig)) {
    console.error('✗ opencode configuration not found');
    console.error(`  Path: ${CONFIG.opencodeConfig}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ opencode configuration found: ${CONFIG.opencodeConfig}`);

  try {
    const opencodeConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));
    let healthy = true;

    // Check subagent_depth
    if (opencodeConfig.subagent_depth === 1) {
      console.log('  ✓ subagent_depth is set to 1');
    } else {
      console.error('  ✗ subagent_depth should be 1');
      console.error(`    Current value: ${opencodeConfig.subagent_depth}`);
      healthy = false;
    }

    // Check task_allowlist
    if (Array.isArray(opencodeConfig.task_allowlist)) {
      const baseDir = findSourceRepo(process.cwd()) || CONFIG.harnessRoot;
      const governedRoles = loadAgentContracts({ baseDir }).manifest.roles.map((role) => role.id);
      const governedSet = new Set(governedRoles);
      const missing = governedRoles.filter((role) => !opencodeConfig.task_allowlist.includes(role));
      const unknown = opencodeConfig.task_allowlist.filter((role) => !governedSet.has(role));

      if (missing.length > 0 || unknown.length > 0) {
        console.error('  ✗ task_allowlist must exactly match manifest-governed roles');
        console.error(`    Current allowlist: ${opencodeConfig.task_allowlist.join(', ')}`);
        if (missing.length > 0) console.error(`    Missing: ${missing.join(', ')}`);
        if (unknown.length > 0) console.error(`    Unknown: ${unknown.join(', ')}`);
        healthy = false;
      } else {
        console.log('  ✓ task_allowlist exactly matches manifest-governed roles');
      }
    } else {
      console.error('  ✗ task_allowlist is missing or malformed');
      healthy = false;
    }

    return healthy;
  } catch (err) {
    console.error('✗ Could not parse opencode configuration');
    return false;
  }
}

function checkOrient() {
  printSection('Checking orient...');

  try {
    const orientPath = execSync('which orient', { encoding: 'utf8' }).trim();
    console.log(`✓ orient found at: ${orientPath}`);

    return true;
  } catch (err) {
    console.error('✗ orient not found in PATH');
    console.error('  Please run: ocode-harness install');
    return false;
  }
}

function checkOcode() {
  printSection('Checking ocode...');

  try {
    const ocodePath = execSync('which ocode', { encoding: 'utf8' }).trim();
    console.log(`✓ ocode found at: ${ocodePath}`);

    return true;
  } catch (err) {
    console.error('✗ ocode not found in PATH');
    console.error('  Please run: ocode-harness install');
    return false;
  }
}

function checkOrientationHealth() {
  printSection('Checking orientation package...');

  if (!existsSync(CONFIG.orientationDir)) {
    console.error('✗ Orientation package not found');
    console.error(`  Path: ${CONFIG.orientationDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Orientation package found: ${CONFIG.orientationDir}`);

  const packageJsonPath = join(CONFIG.orientationDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.error('✗ package.json not found in orientation package');
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`  Package: ${packageJson.name}`);
    console.log(`  Version: ${packageJson.version || 'unknown'}`);

    // Check if tests exist
    const testDir = join(CONFIG.orientationDir, 'test');
    if (existsSync(testDir)) {
      const testFiles = readdirSync(testDir).filter(f => f.endsWith('.mjs'));
      if (testFiles.length > 0) {
        console.log(`  ✓ Tests found: ${testFiles.join(', ')}`);
      } else {
        console.warn('  ⚠ No test files found in orientation package');
      }
    }

    return true;
  } catch (err) {
    console.error('✗ Could not read orientation package.json');
    return false;
  }
}

function checkGitExcludes() {
  printSection('Checking Git excludes...');

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    if (!gitRoot) {
      console.log('  ℹ Not in a git repository');
      return true;
    }

    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');

    if (!existsSync(excludeFile)) {
      console.error('✗ .git/info/exclude not found');
      console.error('  This file should be configured to exclude orientation artifacts');
      return false;
    }

    const excludes = readFileSync(excludeFile, 'utf8');

    if (excludes.includes('.opencode/orientation.json') &&
        excludes.includes('.opencode/orientation.md')) {
      console.log('  ✓ Git excludes configured correctly');
      return true;
    } else {
      console.error('✗ Git excludes not configured correctly');
      console.error('  Expected to find: .opencode/orientation.json and .opencode/orientation.md');
      return false;
    }
  } catch (err) {
    console.error('  ✗ Could not check git excludes (not in git repository or git command failed)');
    return false;
  }
}

function checkPrivateAuthState() {
  printSection('Checking private auth state...');

  const freellmApiKey = process.env.FREELLMAPI_API_KEY;

  if (freellmApiKey && freellmApiKey !== '' && freellmApiKey !== '{env:FREELLMAPI_API_KEY}') {
    console.log('✓ FREELLMAPI_API_KEY: SET');
  } else {
    console.error('✗ FREELLMAPI_API_KEY: MISSING');
  }

  return freellmApiKey && freellmApiKey !== '' && freellmApiKey !== '{env:FREELLMAPI_API_KEY}';
}

function readDoctorMachineConfig() {
  try {
    const config = readMachineConfig(CONFIG.machineConfig);
    console.log(`✓ Ocode machine config: ${CONFIG.machineConfig}`);
    console.log(`  profile: ${config.profile || 'unset'}`);
    console.log(`  closeout.push: ${config.closeout?.push === true ? 'true' : 'false'}`);
    console.log(`  freellmapi.base_url: ${getFreellmapiBaseUrl(config)}`);
    return config;
  } catch (err) {
    console.error(`✗ Ocode machine config unavailable: ${err.message}`);
    return null;
  }
}

function checkFreeLLMAPIThroughOpenCode() {
  try {
    execSync('opencode models freellmapi', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('✓ FreeLLMAPI: AUTHENTICATED');
    console.log('  Source: OpenCode credential store');
    return true;
  } catch (err) {
    return false;
  }
}

async function checkFreeLLMAPIHealth() {
  printSection('Checking FreeLLMAPI health...');

  const machineConfig = readDoctorMachineConfig();
  if (!machineConfig) {
    return false;
  }

  if (process.env.OCODE_DOCTOR_SKIP_NETWORK === '1') {
    console.log('✓ FreeLLMAPI: UNAVAILABLE');
    console.log('  Reason: network check skipped by OCODE_DOCTOR_SKIP_NETWORK');
    return true;
  }

  if (checkFreeLLMAPIThroughOpenCode()) {
    return true;
  }

  const baseUrl = getFreellmapiBaseUrl(machineConfig);
  const apiKey = process.env.FREELLMAPI_API_KEY;
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const headers = {};
    if (apiKey && apiKey !== '{env:FREELLMAPI_API_KEY}') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (response.ok) {
      console.log('✓ FreeLLMAPI: AUTHENTICATED');
      return true;
    }

    if (response.status === 401 || response.status === 403) {
      if (checkFreeLLMAPIThroughOpenCode()) {
        return true;
      }
      console.error('✗ FreeLLMAPI: UNAVAILABLE');
      console.error('  Reason: authentication rejected');
      return false;
    }

    console.error('✗ FreeLLMAPI: UNAVAILABLE');
    console.error(`  Reason: HTTP ${response.status}`);
    return false;
  } catch (err) {
    console.error('✗ FreeLLMAPI: UNAVAILABLE');
    console.error(`  Reason: ${err.name === 'AbortError' ? 'request timed out' : err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function checkOpenAIThroughOpenCode() {
  printSection('Checking OpenAI catalog through OpenCode...');

  const machineConfig = readDoctorMachineConfig();
  if (!machineConfig) return false;
  if (machineConfig.profile !== 'hybrid') {
    console.log(`✓ OpenAI catalog check not required for profile ${machineConfig.profile}`);
    return true;
  }
  if (process.env.OCODE_DOCTOR_SKIP_NETWORK === '1') {
    console.log('✓ OpenAI catalog check skipped by OCODE_DOCTOR_SKIP_NETWORK');
    return true;
  }

  try {
    const output = execSync('opencode models openai', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!output.split('\n').some(line => line.startsWith('openai/'))) {
      console.error('✗ OpenAI: no OpenCode models visible for hybrid profile');
      return false;
    }
    console.log('✓ OpenAI models are visible through OpenCode');
    return true;
  } catch (err) {
    console.error('✗ OpenAI models are not visible through OpenCode for hybrid profile');
    return false;
  }
}

function checkManagedAgentIdentity() {
  printSection('Checking managed agent source/install identity...');

  const sourceRoot = findSourceRepo(process.cwd());
  if (!sourceRoot) {
    console.log('✓ Source repository not available; installed agent presence checked separately');
    return true;
  }

  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const agentFiles = loadAgentContracts({ baseDir: sourceRoot }).manifest.roles.map((role) => role.file);
  let matches = true;

  for (const agentFile of agentFiles) {
    const sourcePath = join(sourceRoot, 'agents', agentFile);
    const installedPath = join(CONFIG.agentsDir, agentFile);
    if (!existsSync(sourcePath) || !existsSync(installedPath) || hash(sourcePath) !== hash(installedPath)) {
      console.error(`  ✗ ${agentFile}: source/install drift`);
      matches = false;
    }
  }

  if (matches) console.log('✓ All managed agent fingerprints match source');
  return matches;
}

function checkCommitterAgent() {
  printSection('Checking committer agent...');

  if (!existsSync(CONFIG.agentsDir)) {
    console.error('✗ Agents directory not found');
    console.error(`  Path: ${CONFIG.agentsDir}`);
    return false;
  }

  const committerPath = join(CONFIG.agentsDir, 'committer.md');
  if (existsSync(committerPath)) {
    console.log(`✓ Committer agent found: ${committerPath}`);

    // Validate committer agent content
    try {
      const content = readFileSync(committerPath, 'utf8');
      const requiredFields = ['---', 'description:', 'mode:', 'permission:'];
      let allValid = true;
      for (const field of requiredFields) {
        if (!content.includes(field)) {
          console.error(`  ✗ Missing required field: ${field}`);
          allValid = false;
        }
      }
      if (content.includes('mode: subagent') && !/^model:/m.test(content)) {
        console.log('  ✓ Committer agent has correct mode and provider-neutral semantics');
      } else {
        console.error('  ✗ Committer agent has incorrect mode or embedded model policy');
        allValid = false;
      }
      return allValid;
    } catch (err) {
      console.error('  ✗ Could not read committer agent');
      return false;
    }
  } else {
    console.error(`✗ Committer agent not found: ${committerPath}`);
    return false;
  }
}

function checkHarnessRuntime() {
  printSection('Checking harness-runtime package...');

  if (!existsSync(CONFIG.harnessRuntimeDir)) {
    console.error('✗ Harness-runtime package not found');
    console.error(`  Path: ${CONFIG.harnessRuntimeDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Harness-runtime package found: ${CONFIG.harnessRuntimeDir}`);

  const packageJsonPath = join(CONFIG.harnessRuntimeDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.error('✗ package.json not found in harness-runtime package');
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    console.log(`  Package: ${packageJson.name}`);
    console.log(`  Version: ${packageJson.version || 'unknown'}`);
  } catch (err) {
    console.error('✗ Could not read harness-runtime package.json');
    return false;
  }

  // Check lib files
  const libFiles = ['identity.mjs', 'lifecycle.mjs', 'ledger.mjs', 'evidence.mjs', 'composition.mjs', 'closeout.mjs', 'verify.mjs', 'governance.mjs', 'agent-contract.mjs', 'permission-projection.mjs', 'admission.mjs', 'opencode-integration.mjs', 'execution.mjs'];
  let allLibFound = true;
  for (const libFile of libFiles) {
    const libPath = join(CONFIG.harnessRuntimeDir, 'lib', libFile);
    if (existsSync(libPath)) {
      console.log(`  ✓ lib/${libFile}`);
    } else {
      console.error(`  ✗ lib/${libFile} not found`);
      allLibFound = false;
    }
  }

  // Check bin file
  const binPath = join(CONFIG.harnessRuntimeDir, 'bin', 'harness.mjs');
  if (existsSync(binPath)) {
    console.log('  ✓ bin/harness.mjs');
  } else {
    console.error('  ✗ bin/harness.mjs not found');
    allLibFound = false;
  }

  return allLibFound;
}

function checkLedgerRuntime() {
  printSection('Checking ledger runtime...');

  const ledgerPath = join(CONFIG.harnessRuntimeDir, 'lib', 'ledger.mjs');
  if (!existsSync(ledgerPath)) {
    console.error('✗ ledger.mjs not found');
    return false;
  }

  try {
    const content = readFileSync(ledgerPath, 'utf8');
    const requiredExports = ['createLedgerRecord', 'appendRecord', 'readRecords', 'getLatestRecord', 'getRecentRecords', 'LEDGER_SCHEMA_VERSION'];
    let allFound = true;
    for (const exp of requiredExports) {
      if (content.includes(`export ${exp.startsWith('export') ? '' : 'function '}${exp}`) || content.includes(`export const ${exp}`) || content.includes(`export function ${exp}`)) {
        console.log(`  ✓ Export: ${exp}`);
      } else if (content.includes(exp)) {
        console.log(`  ✓ Export: ${exp} (found in content)`);
      } else {
        console.error(`  ✗ Export missing: ${exp}`);
        allFound = false;
      }
    }
    return allFound;
  } catch (err) {
    console.error('✗ Could not read ledger.mjs');
    return false;
  }
}

function checkCloseoutRuntime() {
  printSection('Checking closeout runtime...');

  const closeoutPath = join(CONFIG.harnessRuntimeDir, 'lib', 'closeout.mjs');
  if (!existsSync(closeoutPath)) {
    console.error('✗ closeout.mjs not found');
    return false;
  }

  try {
    const content = readFileSync(closeoutPath, 'utf8');
    const requiredExports = ['evaluateGates', 'executeCloseout'];
    let allFound = true;
    for (const exp of requiredExports) {
      if (content.includes(`export function ${exp}`)) {
        console.log(`  ✓ Export: ${exp}`);
      } else if (content.includes(`export ${exp}`)) {
        console.log(`  ✓ Export: ${exp} (found in content)`);
      } else {
        console.error(`  ✗ Export missing: ${exp}`);
        allFound = false;
      }
    }
    return allFound;
  } catch (err) {
    console.error('✗ Could not read closeout.mjs');
    return false;
  }
}

function checkDoctrineFiles() {
  printSection('Checking doctrine files...');

  const doctrineDir = join(CONFIG.harnessRoot, 'doctrine');

  if (!existsSync(doctrineDir)) {
    console.error('✗ Doctrine directory not found');
    console.error(`  Path: ${doctrineDir}`);
    console.error('  Please run: ocode-harness install');
    return false;
  }

  console.log(`✓ Doctrine directory found: ${doctrineDir}`);

  let allValid = true;

  // Validate policy-version.json manifest
  const manifestPath = join(doctrineDir, 'policy-version.json');
  if (!existsSync(manifestPath)) {
    console.error('  ✗ policy-version.json not found');
    return false;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error('  ✗ Could not parse policy-version.json');
    return false;
  }

  const requiredKeys = ['policy_version', 'doctrine', 'resources'];
  for (const key of requiredKeys) {
    if (!(key in manifest)) {
      console.error(`  ✗ Missing required key in manifest: ${key}`);
      allValid = false;
    } else {
      console.log(`  ✓ Manifest key present: ${key}`);
    }
  }

  if (manifest.doctrine && typeof manifest.doctrine.version !== 'undefined') {
    console.log(`  ✓ doctrine.version: ${manifest.doctrine.version}`);
  } else {
    console.error('  ✗ Missing doctrine.version in manifest');
    allValid = false;
  }

  if (manifest.resources && typeof manifest.resources.version !== 'undefined') {
    console.log(`  ✓ resources.version: ${manifest.resources.version}`);
  } else {
    console.error('  ✗ Missing resources.version in manifest');
    allValid = false;
  }

  if (manifest.policy_version !== undefined) {
    console.log(`  ✓ policy_version: ${manifest.policy_version}`);
  }

  // Extract VERSION header from markdown content
  function extractVersionHeader(content) {
    const match = content.match(/<!--\s*VERSION:\s*(\S+)\s*-->/);
    return match ? match[1] : null;
  }

  // Validate agentic-agile.md version header matches manifest
  const agilePath = join(doctrineDir, 'agentic-agile.md');
  if (!existsSync(agilePath)) {
    console.error('  ✗ agentic-agile.md not found');
    allValid = false;
  } else {
    const agileContent = readFileSync(agilePath, 'utf8');
    const agileVersion = extractVersionHeader(agileContent);
    if (agileVersion === null) {
      console.error('  ✗ Could not find VERSION header in agentic-agile.md');
      allValid = false;
    } else if (String(agileVersion) === String(manifest.doctrine?.version)) {
      console.log(`  ✓ agentic-agile.md version header (${agileVersion}) matches manifest`);
    } else {
      console.error(`  ✗ agentic-agile.md version header (${agileVersion}) does not match manifest (${manifest.doctrine?.version})`);
      allValid = false;
    }
  }

  // Validate resource-policy.md version header matches manifest
  const policyPath = join(doctrineDir, 'resource-policy.md');
  if (!existsSync(policyPath)) {
    console.error('  ✗ resource-policy.md not found');
    allValid = false;
  } else {
    const policyContent = readFileSync(policyPath, 'utf8');
    const policyVersion = extractVersionHeader(policyContent);
    if (policyVersion === null) {
      console.error('  ✗ Could not find VERSION header in resource-policy.md');
      allValid = false;
    } else if (String(policyVersion) === String(manifest.resources?.version)) {
      console.log(`  ✓ resource-policy.md version header (${policyVersion}) matches manifest`);
    } else {
      console.error(`  ✗ resource-policy.md version header (${policyVersion}) does not match manifest (${manifest.resources?.version})`);
      allValid = false;
    }
  }

  return allValid;
}

function checkRunLedgerGitExcludes() {
  printSection('Checking run-ledger Git excludes...');

  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();

    if (!gitRoot) {
      console.log('  ℹ Not in a git repository');
      return true;
    }

    const excludeFile = join(gitRoot, '.git', 'info', 'exclude');

    if (!existsSync(excludeFile)) {
      console.error('✗ .git/info/exclude not found');
      console.error('  This file should be configured to exclude run-ledger');
      return false;
    }

    const excludes = readFileSync(excludeFile, 'utf8');

    if (excludes.includes('.opencode/run-ledger.jsonl')) {
      console.log('  ✓ Run-ledger Git exclude configured correctly');
      return true;
    } else {
      console.error('✗ Run-ledger Git exclude not configured');
      console.error('  Expected to find: .opencode/run-ledger.jsonl');
      return false;
    }
  } catch (err) {
    console.error('  ✗ Could not check git excludes (not in git repository or git command failed)');
    return false;
  }
}

async function main() {
  console.log('=== ocode-harness Doctor ===\n');

  const checks = [
    checkOpencode,
    checkOpenCodeBindingOverlay,
    checkExecutionProfilesAndContracts,
    checkGovernanceContracts,
    checkNode,
    checkGit,
    checkAgents,
    checkOrchestratorConfig,
    checkOrient,
    checkOcode,
    checkOrientationHealth,
    checkGitExcludes,
    checkPrivateAuthState,
    checkFreeLLMAPIHealth,
    checkOpenAIThroughOpenCode,
    checkManagedAgentIdentity,
    checkCommitterAgent,
    checkHarnessRuntime,
    checkLedgerRuntime,
    checkCloseoutRuntime,
    checkDoctrineFiles,
    checkRunLedgerGitExcludes,
  ];

  const results = [];

  for (const check of checks) {
    try {
      const result = await check();
      results.push({ name: check.name, result });
    } catch (err) {
      console.error(`Error running ${check.name}:`, err.message);
      results.push({ name: check.name, result: false, error: err.message });
    }
  }

  // Summary
  printSection('Summary');

  const passed = results.filter(r => r.result).length;
  const failed = results.filter(r => !r.result).length;

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed === 0) {
    console.log('\n✓ All checks passed');
    process.exit(0);
  } else {
    console.log('\n✗ Some checks failed');
    console.log('\nRecommendations:');
    console.log('  1. Run: ocode-harness install');
    console.log('  2. Ensure private authentication is configured');
    console.log('  3. Check PATH includes ~/.local/bin');
    process.exit(1);
  }
}

main();
