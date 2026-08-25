# Architecture

## Overview

ocode-harness v0.1 is a portable, deterministic harness for orchestrating AI-powered coding agents. It provides a structured workflow for human-facing engineering coordination, ensuring evidence-backed results through a multi-agent system.

## Core Components

### 1. Orchestrator (Primary Agent)

The orchestrator is the human-facing engineering coordinator that:
- Classifies work into QUICK, STANDARD, or DEEP categories
- Delegates to appropriate subagents based on task complexity
- Ensures independent review of all changes
- Enforces a maximum of two repair cycles
- Returns one evidence-backed result

**Key Permissions:**
- Denies generic Task invocations
- Allows only harness subagents: planner, coder, researcher, verifier, reviewer, judge, committer
- Binds execution to specific git commands for safety

### 2. Subagents (8 Specialized Roles)

#### Planner
- Plans non-trivial implementation work
- Analyzes repository reality, contracts, dependencies, and acceptance evidence
- Returns RECOMMEND_WAYFINDER if task is too uncertain

#### Coder
- Implements bounded repository changes
- Uses TDD for behavior changes with meaningful seams
- Uses diagnosing-bugs for non-obvious defects
- Preserves compatibility unless explicitly authorized

#### Researcher
- Researches current external documentation, APIs, and standards
- Prioritizes primary documentation and authoritative sources
- Returns implementation-relevant interfaces and constraints

#### Verifier
- Independently executes repository validation
- Runs tests, builds, type checks, linters
- Reports exact commands, exit status, and meaningful output
- Does not modify source

#### Reviewer
- Independent read-only review of changes
- Inspects diff, source, tests, regressions, and unsupported claims
- Classifies findings as blockers, concerns, or speculation
- Verifier may be skipped, reviewer never skipped

#### Judge
- Scarce independent second opinion for unresolved technical disagreement
- Uses freellmapi/gemini-3.6-flash model
- Only resolves the specific disputed technical question

#### Committer
- Prepares semantic closeout data and expected paths
- Evaluates bounded completion evidence without mutating the repository
- Does not stage, commit, push, or edit files
- Deterministic runtime owns gate evaluation, exact staging, commit execution, and optional push

### 3. Orientation Package

The orientation package (`packages/orientation/`) provides:
- **Probe.mjs**: Discovers project characteristics (manifests, languages, package managers, commands, authority files, directories, git state)
- **Render.mjs**: Generates orientation.json and orientation.md
- **Orientation.mjs**: Orchestrates probe and render functions
- **Orient.mjs**: CLI wrapper for orientation

**Orientation Output:**
- Schema version 1
- Project metadata (name, root)
- Git information (is_repository, branch, HEAD, dirty)
- Detected technologies (manifests, languages, package manager)
- Commands (test, build, lint, typecheck, verify)
- Authority files (AGENTS.md, CLAUDE.md, README.md, etc.)
- Important directories (src, lib, test, docs, etc.)

### 4. Installation System

The installer (`installer/install.mjs`) provides:
- **Preflight checks**: Node.js, opencode, git availability
- **Backup management**: Creates timestamped backups of existing opencode.json
- **Runtime installation**: Copies orientation package and agents to ~/.local/share/ocode-harness/
- **Binary installation**: Creates orient and ocode wrappers in ~/.local/bin/
- **Config patching**: Merges source config with existing user config, preserves unrelated user settings
- **Git excludes**: Configures .git/info/exclude to ignore orientation artifacts
- **Validation**: Verifies all components are installed correctly

**Backup & Rollback:**
- Backups stored in ~/.local/share/ocode-harness/backups/
- Can restore any previous backup
- Restores entire opencode.json configuration

### 5. Doctor Command

The doctor command (`scripts/doctor.mjs`) performs comprehensive health checks:
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

## Workflow

### QUICK Work (Localized, Low-Risk)
1. Orchestrator classifies as QUICK
2. Orchestrator -> Coder
3. Coder implements change
4. Orchestrator -> Reviewer
5. Reviewer accepts/rejects
6. (Optional) Orchestrator -> Committer
7. Orchestrator returns result

### STANDARD Work (Normal Feature Work)
1. Orchestrator classifies as STANDARD
2. (Optional) Orchestrator -> Planner
3. Orchestrator -> Coder
4. Orchestrator -> Verifier
5. Orchestrator -> Reviewer
6. (Optional) Orchestrator -> Committer
7. Orchestrator returns result

### DEEP Work (Architecture, External Dependencies)
1. Orchestrator classifies as DEEP
2. (Optional) Orchestrator -> Researcher
3. (Optional) Orchestrator -> Planner
4. Orchestrator -> Coder
5. Orchestrator -> Verifier
6. Orchestrator -> Reviewer
7. (Optional) Orchestrator -> Committer
8. (Optional) Orchestrator -> Judge
9. Orchestrator returns result

## Deterministic Contract

### Evidence-Bounded Completion
- Passing tests establish only behavior exercised by those tests
- Reviewer ACCEPT means no blocking defect was identified
- For UNPROVEN/RISKS, never use absolute language like "Fully proven"
- Use "None identified relative to the specified requirements and executed evidence"

### Project Orientation
- Before classifying or delegating, read `.opencode/orientation.md`
- Use it as baseline repository orientation
- Do not repeat discovery already established there unless absent/contradicted
- Pass only relevant orientation facts to delegated workers

### Delegation Contract
- Every Task tool call must specify `subagent_type`
- Allowed subagent types: planner, coder, researcher, verifier, reviewer, judge, committer
- No generic subagents (general, explore, scout, unnamed)
- Role ownership: coder for source mutations, planner for contracts, researcher for docs, verifier for validation, reviewer for review, judge for disagreement, committer for semantic closeout preparation, deterministic runtime for Git mutation

## Security Model

### Secrets Management
- API keys use `{env:VARIABLE_NAME}` placeholder pattern
- URLs use `${env:VARIABLE_NAME:default}` for configurable values
- No secrets committed to repository
- Environment variables checked by doctor command

### Permission Model
- Orchestrator: Denies generic Task invocations, allows specific git commands
- Planner: Denies all external access, allows git status/diff/log/show
- Coder: Allows all bash except git push/reset/clean/commit/rm, allows tdd/diagnosing-bugs/prototype skills
- Verifier: Denies all external access, allows read-only git and test/build/typecheck commands
- Reviewer: Denies all external access, allows read-only git and test commands
- Researcher: Denies all local access, allows websearch/webfetch
- Judge: Denies all external access, denies all skills
- Committer: Read-only semantic closeout preparation; deterministic runtime owns stage, commit, and push

### Git Excludes
- Orientation artifacts (.opencode/orientation.json, .opencode/orientation.md) excluded from version control
- Configured in .git/info/exclude during installation

## Portability

### Installation Paths
- Runtime: `~/.local/share/ocode-harness/`
- Binaries: `~/.local/bin/orient`, `~/.local/bin/ocode`
- Agents: `~/.config/opencode/agents/`
- Config: `~/.config/opencode/opencode.json`
- Backups: `~/.local/share/ocode-harness/backups/`

### Isolated Testing
- Tests use isolated temp HOME directory
- No mutation of real user environment
- Mock binaries for testing

## Testing

### Test Suite
- `test-installer.mjs`: Tests installer against isolated temp HOME
- `test-doctor.mjs`: Tests doctor command health checks
- `test-agents.mjs`: Validates 8 agents exist with correct contracts
- `test-orientation.mjs`: Runs orientation's existing tests
- `test-secrets.mjs`: Verifies no credentials in committed files

### Test Coverage
- Installer functionality
- Agent file integrity and contracts
- Orientation package tests
- Secret detection
- Doctor command health checks

## Version 0.1 Scope

This initial release includes:
- 8 agent definitions with complete permissions
- Orientation package with full probe/render functionality
- Deterministic installer with backup/rollback
- Doctor command for health checks
- Backup management utilities
- Comprehensive test suite
- Security-focused architecture
- Portable, isolated testing
