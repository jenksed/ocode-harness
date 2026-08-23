# ocode-harness v0.1

A portable, deterministic harness for orchestrating AI-powered coding agents with a human-facing engineering coordinator and 7 specialized subagents.

## Overview

ocode-harness provides a structured workflow for engineering work, ensuring evidence-backed results through a multi-agent system:

- **Orchestrator**: Human-facing engineering coordinator
- **Planner**: Plans non-trivial implementation work
- **Coder**: Implements bounded repository changes
- **Researcher**: Researches current external documentation and APIs
- **Verifier**: Independently executes repository validation
- **Reviewer**: Independent read-only review of changes
- **Judge**: Scarce independent second opinion for technical disagreement

## Features

- ✅ **Deterministic Workflow**: Evidence-backed results through multiple agents
- ✅ **Portable Installation**: Single-command installer with backup/rollback
- ✅ **Security First**: No secrets in repository, environment variable-based configuration
- ✅ **Comprehensive Testing**: Isolated tests, agent validation, secret detection
- ✅ **Health Checks**: Doctor command for comprehensive installation verification
- ✅ **Git Integration**: Automatic orientation generation and git excludes
- ✅ **Backup Management**: Timestamped backups with rollback capability

## Installation

### Prerequisites

- Node.js v18 or higher
- opencode (latest version)
- git v2.20 or higher

### Quick Install

```bash
# Clone the repository
git clone https://github.com/yourusername/ocode-harness.git
cd ocode-harness

# Run the installer
node installer/install.mjs
```

### Add to PATH (If Needed)

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

### Verify Installation

```bash
code-harness doctor
```

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

This runs orientation and starts opencode with orientation context.

### Run Tests

```bash
# Run all tests
npm test

# Run specific tests
node test/test-doctor.mjs
node test/test-agents.mjs
node test/test-orientation.mjs
node test/test-secrets.mjs
node test/test-installer.mjs
```

## Configuration

### Environment Variables

Set the following environment variables:

```bash
export FREELLMAPI_API_KEY="your-api-key-here"
export FREELLMAPI_BASE_URL="http://192.168.1.29:3001/v1"
```

### Backup & Rollback

```bash
# Create a backup
code-harness backup create

# List backups
code-harness backup list

# Restore a backup
code-harness backup restore 0

# Delete a backup
code-harness backup delete 1
```

## Documentation

- [Architecture](docs/architecture.md) - System design and component relationships
- [Installation](docs/installation.md) - Detailed installation and troubleshooting guide
- [Profiles](docs/profiles.md) - Configuration profiles and customization
- [Doctor](docs/doctor.md) - Health checks and troubleshooting
- [Security](docs/security.md) - Security model and best practices

## Testing

### Test Suite

The test suite includes:

- **test-installer.mjs**: Tests installer against isolated temp HOME
- **test-doctor.mjs**: Tests doctor command health checks
- **test-agents.mjs**: Validates 7 agents exist with correct contracts
- **test-orientation.mjs**: Runs orientation's existing tests
- **test-secrets.mjs**: Verifies no credentials in committed files

### Running Tests

```bash
# Run all tests
npm test

# Run specific test
node test/test-doctor.mjs
```

## Project Structure

```
ocode-harness/
├── agents/                          # 7 agent definitions
│   ├── orchestrator.md
│   ├── planner.md
│   ├── coder.md
│   ├── verifier.md
│   ├── reviewer.md
│   ├── researcher.md
│   └── judge.md
├── packages/
│   └── orientation/                 # Orientation package
│       ├── lib/
│       │   ├── orientation.mjs
│       │   ├── probe.mjs
│       │   └── render.mjs
│       ├── bin/
│       │   └── orient.mjs
│       ├── test/
│       │   └── orient.test.mjs
│       ├── package.json
│       └── README.md
├── bin/
│   ├── orient                       # orient wrapper
│   └── ocode                        # ocode wrapper
├── installer/
│   └── install.mjs                  # Deterministic installer
├── profiles/                        # Configuration profiles
│   ├── freellmapi.json
│   └── default.json
├── skills/                          # (empty for v0.1)
├── test/                            # Automated tests
│   ├── test-installer.mjs
│   ├── test-doctor.mjs
│   ├── test-agents.mjs
│   ├── test-orientation.mjs
│   └── test-secrets.mjs
├── scripts/                         # Utility scripts
│   ├── doctor.mjs                   # doctor command
│   └── backup.mjs                   # backup/rollback utilities
├── docs/                            # Documentation
│   ├── architecture.md
│   ├── installation.md
│   ├── profiles.md
│   ├── doctor.md
│   └── security.md
├── README.md
├── package.json
└── VERSION
```

## Workflow

### QUICK Work (Localized, Low-Risk)

1. Orchestrator classifies as QUICK
2. Orchestrator → Coder
3. Coder implements change
4. Orchestrator → Reviewer
5. Reviewer accepts/rejects
6. Orchestrator returns result

### STANDARD Work (Normal Feature Work)

1. Orchestrator classifies as STANDARD
2. (Optional) Orchestrator → Planner
3. Orchestrator → Coder
4. Orchestrator → Verifier
5. Orchestrator → Reviewer
6. Orchestrator returns result

### DEEP Work (Architecture, External Dependencies)

1. Orchestrator classifies as DEEP
2. (Optional) Orchestrator → Researcher
3. (Optional) Orchestrator → Planner
4. Orchestrator → Coder
5. Orchestrator → Verifier
6. Orchestrator → Reviewer
7. (Optional) Orchestrator → Judge
8. Orchestrator returns result

## Security

### Secrets Management

- All secrets use environment variables
- Never commit secrets to the repository
- Use `{env:VARIABLE_NAME}` pattern for API keys
- Use `${env:VAR:default}` pattern for base URLs

### Permission System

Each agent has a defined permission set that controls what actions it can perform. The orchestrator denies generic Task invocations and only allows harness subagents.

### Git Excludes

Orientation artifacts are excluded from version control to prevent them from being committed.

## Version 0.1 Scope

This initial release includes:

- ✅ 7 agent definitions with complete permissions
- ✅ Orientation package with full probe/render functionality
- ✅ Deterministic installer with backup/rollback
- ✅ Doctor command for health checks
- ✅ Backup management utilities
- ✅ Comprehensive test suite
- ✅ Security-focused architecture
- ✅ Portable, isolated testing

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for your changes
4. Run the test suite
5. Submit a pull request

## License

MIT

## Support

For issues and questions, please open an issue on GitHub.

## Roadmap

- [ ] Skills system integration
- [ ] Multi-project orientation support
- [ ] Performance optimizations
- [ ] Additional agent types
- [ ] Web interface
- [ ] CI/CD integration
