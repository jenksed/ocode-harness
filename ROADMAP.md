# ROADMAP

## CURRENT: Deterministic Evidence Foundation ✓ COMPLETED

### Core Infrastructure
- [x] **Harness Runtime Package** (`packages/harness-runtime/`)
  - [x] Identity management (UUID v4 task/run IDs)
  - [x] Lifecycle state machine (13 states, legal transitions)
  - [x] Evidence ledger (JSONL, schema v1, validation)
  - [x] Git evidence collection (status, diff, branch, remote)
  - [x] Path reconciliation (expected vs observed)
  - [x] Closeout gates (reviewer, validationEvidence, lifecycle, sensitive paths, merge conflicts)
  - [x] Closeout execution (stage, commit, push)
  - [x] Sensitive path blocking (`.env`, keys, secrets)

### Doctrine & Resource Policy
- [x] **Agentic Agile Operating Doctrine** (`doctrine/agentic-agile.md`)
  - [x] Core principles, minimum sufficient planning
  - [x] Roadmap maturity semantics (IDEA/DISCOVERY/PLANNING READY/PLANNED/ACTIVE/PROVEN/DEFERRED)
  - [x] Evidence-producing increment loop
  - [x] Version manifest (`doctrine/policy-version.json`)
- [x] **Resource Consumption Policy** (`doctrine/resource-policy.md`)
  - [x] Resource tiers (Tier 0-3)
  - [x] Failure taxonomy (CAPABILITY/INFRASTRUCTURE/CONTEXT/IMPLEMENTATION)
  - [x] Resource invariants
- [x] **Deterministic Prompt Composition** (`packages/harness-runtime/lib/composition.mjs`)
  - [x] Compose role prompts from canonical doctrine + policy
  - [x] Role frontmatter preserved
  - [x] No LLM required for composition
- [x] **Deterministic Validation Runner** (`packages/harness-runtime/lib/verify.mjs`)
  - [x] `harness verify` CLI command
  - [x] Validation evidence output (status + commands)
  - [x] No LLM required for validation execution

### Agent Definitions
- [x] **7 Core Agents** + **Committer** (8 total)
  - [x] orchestrator (primary coordinator)
  - [x] planner (architecture/decomposition)
  - [x] coder (implementation)
  - [x] researcher (external docs/API)
  - [x] verifier (independent test/build execution)
  - [x] reviewer (independent read-only review)
  - [x] judge (technical disagreement resolution)
  - [x] committer (semantic closeout preparation, cheap model)

### Installation & Configuration
- [x] **Installer** (`installer/install.mjs`)
- [x] Orientation package deployment
- [x] Harness-runtime package deployment
- [x] Doctrine package deployment
- [x] All 8 agents deployed to `~/.config/opencode/agents/`
  - [x] Binaries: `orient`, `ocode`
  - [x] OpenCode config patching (subagent_depth=1, task_allowlist)
  - [x] Git excludes: `.opencode/orientation.json`, `.opencode/orientation.md`, `.opencode/run-ledger.jsonl`

### Profiles & Configuration
- [x] **Default Profile** (`profiles/default.json`)
  - [x] Provider: freellmapi with auto:smart router
  - [x] Task allowlist: 8 harness subagents only
  - [x] subagent_depth: 1
  - [x] default_agent: orchestrator

### Orchestrator Contract
- [x] **Adaptive Workflow** (QUICK/STANDARD/DEEP)
- [x] **Review Invariant** (mandatory reviewer for source changes)
- [x] **Research Boundary** (external deps → researcher required)
- [x] **Harness Contract** (orientation, delegation, evidence-bounded completion)
- [x] **Delegation Contract** (exact subagent types, role ownership)
- [x] **Committer delegation** added to task allowlist

### Doctor Checks
- [x] System dependencies (opencode, Node.js, git)
- [x] All 8 agents present and valid
- [x] Orchestrator config (subagent_depth, task_allowlist)
- [x] Binaries in PATH
- [x] Orientation package health
- [x] Harness-runtime package health
- [x] Ledger runtime exports
- [x] Closeout runtime exports
- [x] Git excludes (orientation + run-ledger)
- [x] Environment variables
- [x] Doctrine files present and valid (`doctrine/agentic-agile.md`, `doctrine/resource-policy.md`)
- [x] Policy version manifest valid (`doctrine/policy-version.json`)

### Test Suite (All Isolated Temp Directories)
- [x] `test/test-installer.mjs` - Installer validation
- [x] `test/test-doctor.mjs` - Doctor command validation
- [x] `test/test-agents.mjs` - 8 agents validation
- [x] `test/test-orientation.mjs` - Orientation package tests
- [x] `test/test-secrets.mjs` - No credentials in source
- [x] `test/test-ledger.mjs` - Ledger CRUD + validation
- [x] `test/test-lifecycle.mjs` - State machine + transitions
- [x] `test/test-evidence.mjs` - Git evidence + reconciliation
- [x] `test/test-closeout.mjs` - Gates + execution
- [x] `test/test-committer.mjs` - Committer agent contract
- [x] `test/test-composition.mjs` - Prompt composition validation
- [x] `test/test-verify.mjs` - Validation runner verification

---

## NEXT: Deterministic Task Execution Control — PLANNING READY

### Prerequisites (All Satisfied)
- ✓ Ledger records task identity, workflow, agents, files, validation
- ✓ Lifecycle enforces legal state transitions
- ✓ Evidence collects objective git state
- ✓ Closeout gates enforce reviewer/validationEvidence/lifecycle
- ✓ Commiter prepares semantic closeout
- ✓ Orchestrator contract governs delegation
- ✓ Doctor validates full installation

### Phase 1: Task Specification & Planning
- [ ] **Task Spec Schema** (versioned, validated)
  - [ ] Objective, scope, acceptance criteria
  - [ ] Workflow classification (QUICK/STANDARD/DEEP)
  - [ ] Required agents, optional agents
  - [ ] Dependencies, constraints, risks
- [ ] **Planner Agent Enhancement**
  - [ ] Decompose spec → ordered task list
  - [ ] Contract definitions between tasks
  - [ ] Risk assessment per task
  - [ ] Output: `task-spec.json` + `plan.md`
- [ ] **Orchestrator Planning Integration**
  - [ ] Invoke planner for STANDARD/DEEP
  - [ ] Persist plan to ledger
  - [ ] Validate plan before delegation

### Phase 2: Execution Control
- [ ] **Task Runner** (orchestrator-owned)
  - [ ] Sequential task execution per plan
  - [ ] State persistence per task (ledger)
  - [ ] Checkpoint/resume capability
  - [ ] Timeout and step limits per task
- [ ] **Inter-Task Contracts**
  - [ ] File-based handoffs (explicit paths)
  - [ ] Validation gates between tasks
  - [ ] Rollback on contract violation
- [ ] **Resource Governance**
  - [ ] Per-task step budgets
  - [ ] Model selection per role
  - [ ] Concurrency limits (subagent_depth=1)

### Phase 3: Deterministic Closeout
- [ ] **Automated Closeout Pipeline**
  - [ ] Orchestrator → committer → closeout execution
  - [ ] Evidence gate evaluation (reviewer=ACCEPT, validationEvidence.status=PASS)
  - [ ] Path reconciliation before commit
  - [ ] Commit message from committer output
  - [ ] Push to remote (configurable)
- [ ] **Ledger Finalization**
  - [ ] Record closeout result (committed, pushed, SHA)
  - [ ] Final lifecycle state: COMPLETE/BLOCKED/FAILED
  - [ ] Elapsed time, infrastructure failures, retries

### Phase 4: Observability & Debugging
- [ ] **Structured Logging**
  - [ ] JSONL per-task logs (stdout/stderr/agent calls)
  - [ ] Correlation IDs (task_id, run_id)
  - [ ] Log aggregation for doctor/analysis
- [ ] **Replay Capability**
  - [ ] Re-run task from ledger record
  - [ ] Compare evidence before/after
  - [ ] Diff validation results

---

## LATER: Worktree Control Requirements

### Git Worktree Isolation
- [ ] **Per-Task Worktrees**
  - [ ] Create worktree per task from base commit
  - [ ] Isolate changes per task
  - [ ] Clean up worktree on completion/abort
- [ ] **Worktree Lifecycle**
  - [ ] `git worktree add` on task start
  - [ ] `git worktree remove` on task end
  - [ ] Handle nested/parallel worktrees
- [ ] **Base Commit Management**
  - [ ] Track base commit per run
  - [ ] Rebase/merge strategy for integration
  - [ ] Conflict detection before merge

### Multi-Task Coordination
- [ ] **Parallel Task Execution** (when subagent_depth > 1)
  - [ ] Dependency graph from planner
  - [ ] Worktree isolation for parallel tasks
  - [ ] Merge queue for integration
- [ ] **Cross-Task Evidence**
  - [ ] Shared ledger across tasks
  - [ ] Aggregated validation results
  - [ ] Unified closeout for multi-task runs

---

## LATER: Sub-Agent Governance Requirements

### Agent Registry & Versioning
- [ ] **Agent Manifest**
  - [ ] Versioned agent definitions
  - [ ] Capability declarations (tools, models, permissions)
  - [ ] Compatibility matrix (orchestrator version ↔ agent versions)
- [ ] **Agent Upgrade Path**
  - [ ] Backward-compatible agent updates
  - [ ] Migration guide per version
  - [ ] Deprecation policy

### Dynamic Agent Selection
- [ ] **Capability-Based Routing**
  - [ ] Orchestrator selects agent by capability, not name
  - [ ] Fallback chains (preferred → available)
  - [ ] Model-aware routing (cost/quality tradeoff)

### Agent Observability
- [ ] **Per-Agent Metrics**
  - [ ] Step count, token usage, latency
  - [ ] Success/failure rates by task type
  - [ ] Repair cycle frequency
- [ ] **Agent Health Checks**
  - [ ] Liveness/readiness per agent type
  - [ ] Model availability verification
  - [ ] Tool permission validation

---

## Dependencies on Current Primitives

| Future Feature | Depends On | Status |
|----------------|------------|--------|
| Task Spec Schema | Ledger schema, validation | ✓ Ready |
| Planner Integration | Orchestrator contract, delegation | ✓ Ready |
| Task Runner | Lifecycle, ledger, evidence | ✓ Ready |
| Inter-Task Contracts | Path reconciliation, evidence | ✓ Ready |
| Automated Closeout | Closeout gates, committer, evidence | ✓ Ready |
| Worktree Isolation | Git evidence, lifecycle states | ✓ Ready |
| Multi-Task Coordination | Ledger aggregation, lifecycle | ✓ Ready |
| Agent Registry | Agent definitions, permissions | ✓ Ready |
| Capability Routing | Orchestrator contract, task allowlist | ✓ Ready |

---

## Design Principles (Invariant)

1. **Determinism First** — Every operation has defined inputs, outputs, and failure modes
2. **Evidence Over Trust** — No completion claim without independent validation
3. **Isolation By Default** — Worktrees, temp dirs, no shared mutable state
4. **Explicit Contracts** — File paths, schemas, transitions all declared
5. **Cheap Abundance** — Commiter, verifier use small models; expensive models for planning/coding
6. **Human Authority Boundaries** — Orchestrator is only human-facing agent
7. **Auditability** — Every decision traceable to ledger record
8. **Recoverability** — BLOCKED/FAILED → ACTIVE transitions always possible

---

## Version Milestones

| Version | Focus | Target |
|---------|-------|--------|
| v0.1 | Deterministic Evidence Foundation | ✓ Done |
| v0.2 | Task Execution Control (Planning + Runner) | Planning |
| v0.3 | Automated Closeout Pipeline | Planned |
| v0.4 | Worktree Isolation | Planned |
| v0.5 | Multi-Task Coordination | Planned |
| v1.0 | Sub-Agent Governance + Observability | Planned |