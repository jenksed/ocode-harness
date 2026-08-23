# Doctor

## Overview

The `code-harness doctor` command performs a comprehensive health check of your ocode-harness installation. It verifies that all components are correctly installed, configured, and ready to use.

## Running Doctor

```bash
code-harness doctor
```

## What Doctor Checks

### 1. opencode

- **Check**: opencode availability and version
- **Expected**: opencode is installed and accessible via PATH
- **Details**: Shows the path and version of opencode

### 2. Node.js

- **Check**: Node.js availability and version
- **Expected**: Node.js v18 or higher is installed
- **Details**: Shows the path and version of Node.js

### 3. git

- **Check**: git availability and version
- **Expected**: git v2.20 or higher is installed
- **Details**: Shows the path and version of git

### 4. Agents Directory

- **Check**: Agents directory exists
- **Expected**: `~/.config/opencode/agents/` exists
- **Details**: Shows the path to the agents directory

### 5. Agent Files

- **Check**: All 7 agent files are present
- **Expected**: orchestrator.md, planner.md, coder.md, verifier.md, reviewer.md, researcher.md, judge.md
- **Details**: Verifies each agent file exists

### 6. Orchestrator Configuration

- **Check**: subagent_depth is set to 1
- **Expected**: `subagent_depth` is set to 1 in opencode.json
- **Details**: Shows the current value of subagent_depth

### 7. Task Allowlist

- **Check**: Task allowlist includes only harness subagents
- **Expected**: Allowlist contains: planner, coder, researcher, verifier, reviewer, judge
- **Details**: Verifies no generic subagents (general, explore, scout) are in the allowlist

### 8. orient

- **Check**: orient binary exists
- **Expected**: `~/.local/bin/orient` exists and is executable
- **Details**: Shows the path to orient

### 9. ocode

- **Check**: ocode binary exists
- **Expected**: `~/.local/bin/ocode` exists and is executable
- **Details**: Shows the path to ocode

### 10. Orientation Package

- **Check**: Orientation package is installed
- **Expected**: `~/.local/share/ocode-harness/orientation/` exists
- **Details**: Shows the package name and version

### 11. Git Excludes

- **Check**: Git excludes are configured correctly
- **Expected**: `.git/info/exclude` contains `.opencode/orientation.json` and `.opencode/orientation.md`
- **Details**: Shows whether git excludes are configured

### 12. Environment Variables

- **Check**: FREELLMAPI_API_KEY is set
- **Expected**: FREELLMAPI_API_KEY is set and not using placeholder
- **Details**: Shows whether the API key is set (masked)
- **Check**: FREELLMAPI_BASE_URL is set or has default
- **Expected**: FREELLMAPI_BASE_URL is set or defaults to `http://192.168.1.29:3001/v1`
- **Details**: Shows whether the base URL is configured

## Doctor Output Example

```
============================================================
Checking opencode...
✓ opencode found at: /usr/local/bin/opencode
  Version: opencode-1.0.0

============================================================
Checking Node.js...
✓ Node.js found at: /usr/local/bin/node
  Version: v20.10.0

============================================================
Checking git...
✓ git found at: /usr/local/bin/git
  Version: git version 2.40.0

============================================================
Checking agents...
✓ Agents directory found: /Users/joshuajenks/.config/opencode/agents

✓ orchestrator.md
✓ planner.md
✓ coder.md
✓ verifier.md
✓ reviewer.md
✓ researcher.md
✓ judge.md

============================================================
Checking orchestrator configuration...
✓ opencode configuration found: /Users/joshuajenks/.config/opencode/opencode.json
  ✓ subagent_depth is set to 1
  ✓ task_allowlist includes only harness subagents

============================================================
Checking orient...
✓ orient found at: /Users/joshuajenks/.local/bin/orient

============================================================
Checking ocode...
✓ ocode found at: /Users/joshuajenks/.local/bin/ocode

============================================================
Checking orientation package...
✓ Orientation package found: /Users/joshuajenks/.local/share/ocode-harness/orientation
  Package: project-orientation-v1
  Version: unknown
  ✓ Tests found: orient.test.mjs

============================================================
Checking Git excludes...
✓ Git excludes configured correctly

============================================================
Checking environment variables...
✓ FREELLMAPI_API_KEY is set
  Value: abc123...xyz789
✓ FREELLMAPI_BASE_URL is set
  Value: http://192.168.1.29:3001/v1

============================================================
Summary
============================================================
Passed: 12/12
Failed: 0/12

✓ All checks passed

Next steps:
  1. Run "orient ." in your project directory to generate orientation
  2. Run "ocode" to start the harness
```

## Common Issues and Solutions

### Issue: opencode not found

**Solution:**
```bash
# Check if opencode is installed
which opencode

# If not found, install opencode first
npm install -g opencode
```

### Issue: Node.js not found

**Solution:**
```bash
# Check if Node.js is installed
which node

# If not found, install Node.js from https://nodejs.org/
```

### Issue: git not found

**Solution:**
```bash
# Check if git is installed
which git

# If not found, install git:
# macOS: xcode-select --install
# Linux: sudo apt-get install git
# Windows: Install from https://git-scm.com/
```

### Issue: Agents directory not found

**Solution:**
```bash
# Run the installer
node installer/install.mjs
```

### Issue: subagent_depth is not set to 1

**Solution:**
```bash
# Run the installer (it will patch the configuration)
node installer/install.mjs
```

### Issue: orient/ocode not found

**Solution:**
```bash
# Run the installer
node installer/install.mjs

# Add ~/.local/bin to PATH
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Issue: Orientation package not found

**Solution:**
```bash
# Run the installer
node installer/install.mjs
```

### Issue: Git excludes not configured

**Solution:**
```bash
# Run the installer (it will configure git excludes)
node installer/install.mjs
```

### Issue: FREELLMAPI_API_KEY not set

**Solution:**
```bash
# Set the environment variable
export FREELLMAPI_API_KEY="your-api-key-here"

# Make it permanent
echo 'export FREELLMAPI_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

### Issue: FREELLMAPI_BASE_URL not set

**Solution:**
```bash
# Set the environment variable
export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"

# Make it permanent
echo 'export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"' >> ~/.zshrc
source ~/.zshrc
```

## Integration with Other Commands

### Backup

```bash
# Create a backup before running doctor
code-harness backup create

# Run doctor
code-harness doctor

# If doctor fails, restore the backup
code-harness backup restore 0
```

### Installation

```bash
# Run doctor before installation
code-harness doctor

# If doctor passes, run installer
node installer/install.mjs

# Run doctor again after installation
code-harness doctor
```

## Automated Testing

Doctor can be used in automated tests:

```javascript
const { execSync } = require('child_process');

try {
  execSync('code-harness doctor', { stdio: 'inherit' });
  console.log('✓ All checks passed');
} catch (err) {
  console.error('✗ Some checks failed');
  process.exit(1);
}
```

## Best Practices

1. **Run Doctor Regularly**: Run `code-harness doctor` periodically to ensure your installation is up to date.

2. **Before Making Changes**: Run doctor before making changes to verify the current state.

3. **After Installation**: Run doctor after installation to verify the installation was successful.

4. **Before Production**: Run doctor before deploying to production to ensure all components are working.

5. **Document Results**: Save doctor output for debugging and documentation purposes.

## Next Steps

1. **Read Architecture**: [architecture.md](architecture.md)
2. **Read Installation**: [installation.md](installation.md)
3. **Read Profiles**: [profiles.md](profiles.md)
4. **Read Security**: [security.md](security.md)
