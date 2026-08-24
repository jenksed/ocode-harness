# Installation

## Prerequisites

Before installing ocode-harness, ensure you have:

- **Node.js**: v18 or higher
  ```bash
  node --version
  ```
- **opencode**: Latest version
  ```bash
  opencode --version
  ```
- **git**: v2.20 or higher
  ```bash
  git --version
  ```

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/ocode-harness.git
cd ocode-harness
```

### Step 2: Run the Installer

```bash
node installer/install.mjs
```

The installer will:

1. **Preflight Checks**: Verify Node.js, opencode, and git are installed
2. **Backup Management**: Create a timestamped backup of your existing opencode configuration (if any)
3. **Install Runtime**: Copy the orientation package and 8 agent definitions to:
   - `~/.local/share/ocode-harness/orientation/`
   - `~/.config/opencode/agents/`
4. **Install Binaries**: Create orient and ocode wrappers in `~/.local/bin/`
5. **Patch Configuration**: Merge source configuration with your existing config (preserving unrelated user settings)
6. **Configure Git**: Set up .git/info/exclude to ignore orientation artifacts
7. **Validate Installation**: Verify all components are installed correctly

### Step 3: Add to PATH (If Needed)

The installer adds `~/.local/bin` to your PATH during installation. If you need to manually add it:

**Zsh (macOS/Linux):**
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**Bash (Linux):**
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**PowerShell (Windows):**
```powershell
$env:Path += ";$env:USERPROFILE\.local\bin"
```

### Step 4: Verify Installation

```bash
code-harness doctor
```

This will check:
- opencode availability and version
- Node.js availability and version
- git availability and version
- Agents directory and 8 agent files
- Orchestrator configuration (subagent_depth=1)
- Task allowlist (only harness subagents)
- orient and ocode binaries
- Orientation package health
- Git excludes configuration
- Environment variables (FREELLMAPI_API_KEY, FREELLMAPI_BASE_URL)

## Configuration

### Environment Variables

Set the following environment variables for FreeLLMAPI:

```bash
export FREELLMAPI_API_KEY="your-api-key-here"
export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"
```

**Note:** The API key is never stored in the repository; it must be set via environment variable.

### opencode Configuration

The installer patches your `~/.config/opencode/opencode.json` with:

- `subagent_depth: 1` - Limits subagent depth to 1
- Harness-specific model configurations
- Task allowlist (only harness subagents)

Your existing configuration is preserved and merged with the source configuration.

### Agent Files

Agent definitions are stored in `~/.config/opencode/agents/`:

- `orchestrator.md` - Primary coordinator
- `planner.md` - Implementation planner
- `coder.md` - Code implementer
- `verifier.md` - Independent validator
- `reviewer.md` - Independent reviewer
- `researcher.md` - External researcher
- `judge.md` - Technical disagreement resolver
- `committer.md` - Git commit/closeout agent

## Usage

### Generate Project Orientation

```bash
cd your-project-directory
orient .
```

This creates:
- `.opencode/orientation.json` - Machine-readable orientation
- `.opencode/orientation.md` - Human-readable orientation

### Start the Harness

```bash
ocode
```

This:
1. Runs orientation on the current directory
2. Finds the project root with orientation artifacts
3. Starts opencode with orientation context

### Run Tests

```bash
# Run all tests
npm test

# Run specific test
node test/test-doctor.mjs
node test/test-agents.mjs
node test/test-orientation.mjs
node test/test-secrets.mjs
```

## Backup & Rollback

### Create a Backup

```bash
code-harness backup create
```

### List Backups

```bash
code-harness backup list
```

### Restore a Backup

```bash
code-harness backup restore 0  # Restore the most recent backup
```

### Delete a Backup

```bash
code-harness backup delete 1  # Delete backup at index 1
```

## Troubleshooting

### Installation Fails

If the installer fails:

1. **Check Prerequisites**:
   ```bash
   node --version
   opencode --version
   git --version
   ```

2. **Verify PATH**:
   ```bash
   which node opencode git
   ```

3. **Run Doctor**:
   ```bash
   code-harness doctor
   ```

### orient/ocode Not Found

If orient or ocode is not in PATH:

1. **Verify Installation**:
   ```bash
   ls ~/.local/bin/orient
   ls ~/.local/bin/ocode
   ```

2. **Check PATH**:
   ```bash
   echo $PATH | grep local/bin
   ```

3. **Manually Add to PATH** (see Step 3 above)

### Environment Variables Not Set

1. **Check Variables**:
   ```bash
   echo $FREELLMAPI_API_KEY
   echo $FREELLMAPI_BASE_URL
   ```

2. **Set Variables**:
   ```bash
   export FREELLMAPI_API_KEY="your-key"
   export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"
   ```

3. **Make Permanent** (add to shell config):
   ```bash
   echo 'export FREELLMAPI_API_KEY="your-key"' >> ~/.zshrc
   echo 'export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"' >> ~/.zshrc
   source ~/.zshrc
   ```

### Git Excludes Not Configured

If git excludes are missing:

1. **Check .git/info/exclude**:
   ```bash
   cat .git/info/exclude
   ```

2. **Manually Configure**:
   ```bash
   echo -e '.opencode/orientation.json\n.opencode/orientation.md\n# Do not track orientation artifacts' >> .git/info/exclude
   ```

## Uninstallation

To remove ocode-harness:

1. **Restore Backup** (if you have one):
   ```bash
   code-harness backup restore 0
   ```

2. **Remove Files**:
   ```bash
   rm -rf ~/.local/share/ocode-harness
   rm -rf ~/.config/opencode/agents
   rm ~/.local/bin/orient
   rm ~/.local/bin/ocode
   rm ~/.config/opencode/opencode.json
   ```

3. **Remove from PATH** (edit your shell config and remove the PATH export)

4. **Verify Removal**:
   ```bash
   which orient ocode
   # Should not return anything
   ```

## Next Steps

1. **Read Documentation**:
   - [Architecture](architecture.md) - Understand the system design
   - [Profiles](profiles.md) - Learn about configuration profiles
   - [Doctor](doctor.md) - Learn about health checks
   - [Security](security.md) - Understand security model

2. **Generate Orientation**:
   ```bash
   cd your-project
   orient .
   ```

3. **Start Harness**:
   ```bash
   ocode
   ```

4. **Run Doctor**:
   ```bash
   code-harness doctor
   ```
