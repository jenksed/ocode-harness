# Security

## Overview

ocode-harness v0.1 is designed with security as a first-class concern. This document outlines the security model, secrets management, permission system, and best practices for secure usage.

## Secrets Management

### Environment Variables

All secrets must be provided via environment variables. Never hardcode secrets in the repository.

#### API Key Pattern

```json
"apiKey": "{env:FREELLMAPI_API_KEY}"
```

This pattern ensures:
- Secrets are never committed to the repository
- Secrets are loaded at runtime from environment variables
- Secrets are not visible in the source code

#### Base URL Pattern

```json
"baseURL": "http://127.0.0.1:3001/v1"
```

This pattern provides:
- Default value for development
- Override capability for production
- No secrets in the default value

### Setting Environment Variables

#### Per-Session

```bash
export FREELLMAPI_API_KEY="your-api-key-here"
export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"
```

#### Permanent (Shell Config)

**Zsh (macOS/Linux):**
```bash
echo 'export FREELLMAPI_API_KEY="your-api-key-here"' >> ~/.zshrc
echo 'export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"' >> ~/.zshrc
source ~/.zshrc
```

**Bash (Linux):**
```bash
echo 'export FREELLMAPI_API_KEY="your-api-key-here"' >> ~/.bashrc
echo 'export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"' >> ~/.bashrc
source ~/.bashrc
```

**PowerShell (Windows):**
```powershell
$env:FREELLMAPI_API_KEY = "your-api-key-here"
$env:FREELLMAPI_BASE_URL = "http://127.0.0.1:3001/v1"
```

### Environment Variable Validation

The doctor command validates that environment variables are set:

```bash
code-harness doctor
```

This checks:
- FREELLMAPI_API_KEY is set and not empty
- FREELLMAPI_BASE_URL is set or has a default value

## Permission System

Each agent has a defined permission set that controls what actions it can perform.

### Orchestrator Permissions

```yaml
permission:
  edit: deny
  external_directory: deny
  question: allow
  websearch: deny
  webfetch: deny
  skill:
    "*": deny
    "setup-matt-pocock-skills": ask
    "wayfinder": ask
    "grill-with-docs": ask
    "to-spec": ask
    "to-tickets": ask
    "implement": ask
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
  task:
    "*": deny
    planner: allow
    coder: allow
    researcher: allow
    verifier: allow
    reviewer: allow
    judge: allow
    committer: allow
```

**Security Features:**
- **edit: deny**: Orchestrator cannot directly modify source files
- **external_directory: deny**: Orchestrator cannot access external directories
- **task: deny**: Orchestrator cannot invoke generic Task invocations
- **bash: deny**: Orchestrator cannot execute arbitrary commands
- **git commands only**: Orchestrator can only read git status, diff, log, and show

### Coder Permissions

```yaml
permission:
  edit: allow
  external_directory: deny
  question: deny
  task: deny
  skill:
    "*": deny
    "tdd": allow
    "diagnosing-bugs": allow
    "prototype": allow
  bash:
    "*": allow
    "git push": deny
    "git push *": deny
    "git add": deny
    "git add *": deny
    "git reset --hard": deny
    "git reset --hard *": deny
    "git clean": deny
    "git clean *": deny
    "git commit": deny
    "git commit *": deny
    "rm -rf *": deny
```

**Security Features:**
- **edit: allow**: Coder can modify source files
- **Denies dangerous git commands**: Cannot stage, push, reset, clean, or commit
- **Denies destructive commands**: Cannot remove directories with `rm -rf`
- **Allowed skills**: Only TDD, diagnosing-bugs, prototype

### Verifier Permissions

```yaml
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  skill: deny
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "npm test": allow
    "npm test *": allow
    "npm run test": allow
    "npm run test *": allow
    "npm run build": allow
    "npm run build *": allow
    "npm run typecheck": allow
    "npm run typecheck *": allow
    "pnpm test": allow
    "pnpm test *": allow
    "pnpm build": allow
    "pnpm build *": allow
    "go test *": allow
    "go build *": allow
    "pytest": allow
    "pytest *": allow
    "python -m pytest": allow
    "python -m pytest *": allow
    "mix test": allow
    "mix test *": allow
    "mix compile": allow
    "mix compile *": allow
    "cargo test": allow
    "cargo test *": allow
    "cargo build": allow
    "cargo build *": allow
```

**Security Features:**
- **edit: deny**: Verifier cannot modify source files
- **Read-only git**: Can only read git status and diff
- **Test/build/typecheck commands**: Can run validation commands but not modify code

### Reviewer Permissions

```yaml
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  skill:
    "*": deny
    "code-review": allow
    "domain-modeling": allow
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
    "npm test": allow
    "npm test *": allow
    "npm run test": allow
    "npm run test *": allow
    "pnpm test": allow
    "pnpm test *": allow
    "yarn test": allow
    "yarn test *": allow
    "go test *": allow
    "pytest": allow
    "pytest *": allow
    "python -m pytest": allow
    "python -m pytest *": allow
    "mix test": allow
    "mix test *": allow
    "cargo test": allow
    "cargo test *": allow
```

**Security Features:**
- **edit: deny**: Reviewer cannot modify source files
- **Read-only access**: Can only read git status, diff, log, and show
- **Test commands**: Can run tests but cannot modify code

### Researcher Permissions

```yaml
permission:
  edit: deny
  bash: deny
  external_directory: deny
  question: deny
  task: deny
  websearch: allow
  webfetch: allow
  skill:
    "*": deny
    "research": allow
```

**Security Features:**
- **edit: deny**: Researcher cannot modify source files
- **No bash access**: Cannot execute any local commands
- **External access**: Can search and fetch from the web

### Judge Permissions

```yaml
permission:
  edit: deny
  bash: deny
  external_directory: deny
  question: deny
  task: deny
  skill: deny
```

**Security Features:**
- **edit: deny**: Judge cannot modify source files
- **No external access**: Cannot search or fetch from the web
- **No bash access**: Cannot execute any commands

### Committer Permissions

```yaml
permission:
  edit: deny
  external_directory: deny
  question: deny
  task: deny
  websearch: deny
  webfetch: deny
  skill:
    "*": deny
  bash:
    "*": deny
    "git status": allow
    "git status *": allow
    "git diff": allow
    "git diff *": allow
    "git log": allow
    "git log *": allow
    "git show *": allow
```

**Security Features:**
- **edit: deny**: Committer cannot modify repository files
- **Read-only Git inspection**: Can inspect status, diff, log, and shown objects
- **No Git mutation authority**: Cannot stage, commit, or push
- **No external access**: Cannot search or fetch from the web
- **Deterministic runtime ownership**: Gate evaluation, exact staging, commit execution, and optional push occur outside the semantic role

## Task Allowlist

The `task_allowlist` in the opencode configuration restricts which subagent types can be invoked.

### Harness Subagents Only

```json
  "task_allowlist": [
    "planner",
    "coder",
    "researcher",
    "verifier",
    "reviewer",
    "judge",
    "committer"
  ]
```

**Security Features:**
- **Generic subagents blocked**: No generic, explore, or scout agents
- **Harness subagents only**: Only the 8 harness agents are allowed
- **Prevents unauthorized delegation**: Orchestrator cannot invoke arbitrary agents

## Git Excludes

Orientation artifacts are excluded from version control to prevent them from being committed.

### Configuration

```bash
# .git/info/exclude
.opencode/orientation.json
.opencode/orientation.md
# Do not track orientation artifacts
```

### Security Benefits

1. **No Secrets in Git**: Orientation artifacts contain no secrets
2. **Deterministic Output**: Orientation artifacts are generated, not edited
3. **No Unnecessary History**: Orientation artifacts are not versioned

## File Permissions

### Binary Files

```bash
chmod +x ~/.local/bin/orient
chmod +x ~/.local/bin/ocode
```

### Agent Files

```bash
chmod 644 ~/.config/opencode/agents/*.md
```

### Configuration Files

```bash
chmod 644 ~/.config/opencode/opencode.json
```

## Backup Security

### Backup Location

```bash
~/.local/share/ocode-harness/backups/
```

### Backup Security Features

1. **Encrypted Secrets**: Backups contain no secrets (secrets are environment variables)
2. **Timestamped**: Each backup has a unique timestamp
3. **Isolated**: Backups are isolated from the repository

### Backup Restoration

```bash
# Restore a backup
code-harness backup restore 0
```

**Security Features:**
- **Manual confirmation**: Requires explicit command to restore
- **Preserves secrets**: Backups contain no secrets
- **Rollback capability**: Can revert to previous state

## Environment Isolation

### Testing

Tests use isolated temp HOME directories:

```javascript
const testHome = join(tmpdir(), `ocode-harness-test-${Date.now()}`);
```

**Security Features:**
- **No mutation of real environment**: Tests do not affect real user environment
- **Isolated execution**: Each test has its own isolated environment

## Code Signing

### No External Dependencies

The installer and binaries have no external dependencies (except Node.js and opencode).

### Source Code Verification

```bash
git verify-tag v0.1.0
```

## Best Practices

### 1. Never Commit Secrets

- ✅ Use `{env:VARIABLE_NAME}` pattern
- ❌ Never hardcode API keys
- ❌ Never commit environment variable files

### 2. Use Environment Variables

```bash
# Set per-session
export FREELLMAPI_API_KEY="your-key"

# Set permanently
echo 'export FREELLMAPI_API_KEY="your-key"' >> ~/.zshrc
source ~/.zshrc
```

### 3. Restrict Permissions

- ✅ Use the default permission sets
- ❌ Modify permission sets without understanding the implications

### 4. Validate Configuration

```bash
# Run doctor before using
code-harness doctor
```

### 5. Use Git Excludes

- ✅ Let the installer configure git excludes
- ❌ Manually edit .git/info/exclude

### 6. Secure Backups

- ✅ Keep backups in isolated directory
- ❌ Share backup files

### 7. Regular Security Audits

```bash
# Run doctor regularly
code-harness doctor

# Check for secrets in committed files
node test/test-secrets.mjs
```

## Threat Model

### Potential Threats

1. **Secrets in Repository**
   - **Mitigation**: Use `{env:VARIABLE_NAME}` pattern, run test-secrets.mjs
   - **Detection**: test-secrets.mjs

2. **Unauthorized File Modification**
   - **Mitigation**: Permission system, git excludes
   - **Detection**: Doctor command

3. **Arbitrary Command Execution**
   - **Mitigation**: Permission system, bash command restrictions
   - **Detection**: Doctor command

4. **Secrets in Backups**
   - **Mitigation**: Backups contain no secrets (secrets are environment variables)
   - **Detection**: Manual inspection

5. **Unauthorized Agent Invocation**
   - **Mitigation**: Task allowlist, orchestrator permissions
   - **Detection**: Doctor command

## Incident Response

### If Secrets Are Compromised

1. **Rotate API Keys**:
   ```bash
   # Generate new API key
   # Update environment variable
   export FREELLMAPI_API_KEY="new-key"
   ```

2. **Check Logs**:
   ```bash
   # Check opencode logs
   tail -f ~/.opencode/logs/*
   ```

3. **Review Agent Activity**:
   ```bash
   # Check git history
   git log --all --oneline
   ```

4. **Restore from Backup**:
   ```bash
   code-harness backup restore 0
   ```

### If Installation Is Compromised

1. **Run Doctor**:
   ```bash
   code-harness doctor
   ```

2. **Remove Installation**:
   ```bash
   rm -rf ~/.local/share/ocode-harness
   rm -rf ~/.config/opencode/agents
   rm ~/.local/bin/orient
   rm ~/.local/bin/ocode
   ```

3. **Restore from Backup**:
   ```bash
   code-harness backup restore 0
   ```

## Compliance

### Data Privacy

- **No Secrets Stored**: All secrets are environment variables
- **No Personal Data**: No personal data is collected or stored
- **No Telemetry**: No telemetry or analytics

### Regulatory Compliance

- **GDPR**: No personal data is collected
- **SOC 2**: No secrets are stored in the repository
- **HIPAA**: No healthcare data is handled

## Next Steps

1. **Read Architecture**: [architecture.md](architecture.md)
2. **Read Installation**: [installation.md](installation.md)
3. **Read Profiles**: [profiles.md](profiles.md)
4. **Read Doctor**: [doctor.md](doctor.md)
