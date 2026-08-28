# ocode-harness v0.1

Ocode is a deterministic harness around OpenCode for governed coding-agent work. It keeps model routing, agent responsibility, execution permission, evidence, review, and release promotion separate enough that one mechanism does not silently become authority for another.

## Start here

Prerequisites:

- Node.js 18+
- Git
- OpenCode `1.18.21` for the currently qualified runtime contract

From a clean checkout:

```bash
npm ci
npm test
npm run bootstrap
ocode version
```

Normal use:

```bash
cd /path/to/project
ocode .
```

The installed runtime lives under `~/.local/share/ocode-harness`. Editing this checkout does not mutate that installed runtime. Promotion is explicit.

## Stable operator surface

Use `ocode` for normal operation and release maintenance:

```bash
ocode .                         # run Ocode in the current project
ocode --profile free .          # one-run profile override
ocode profile                   # show effective role bindings
ocode profile explain reviewer
ocode profile diff free hybrid
ocode agents                    # current work/agent view
ocode activity                  # current activity view
ocode govern explain coder      # capability/authority/permission projection
ocode govern audit
ocode version                   # installed + checkout version/SHA/ref/dirty state
ocode update                    # promote this checkout into the isolated runtime
ocode rollback                  # restore the newest installation backup
```

`harness` remains installed for deterministic/internal compatibility commands such as ledger, lifecycle, closeout, evidence, and verify. It is not the normal operator entrypoint.

Health and repository validation are development commands:

```bash
npm run doctor
npm test
```

Milestone-named `acceptance:*` scripts remain for historical/regression evidence. They are not the normal current validation surface; use `npm test` unless you are investigating the milestone contract itself.

## Release identity and development isolation

`VERSION` is the semantic product version. It is not sufficient to identify executable code.

Every promotion now writes `RELEASE.json` into the installed release with:

- semantic version;
- full source commit SHA when the source is a Git checkout;
- source branch/ref when available;
- source dirty state.

`ocode version` compares the installed identity with the checkout identity. Two commits carrying the same semantic version are therefore distinguishable.

A dirty Git checkout is not promotable: its commit SHA would not identify the bytes being installed. Commit or stash changes first. A non-Git source remains supported for legacy/test fixtures, but its exact source identity is reported as unavailable rather than invented.

`ocode update` stages a candidate, validates it, backs up the currently installed runtime, promotes the candidate, and runs post-promotion checks. A failure before promotion no longer consumes a backup or rolls back an otherwise healthy installation. A failure after promotion attempts rollback.

## Architecture in one page

The main concepts answer different questions:

| Concept | Question | Primary authority |
| --- | --- | --- |
| Agent | Who is responsible? | `agents/manifest.json` + canonical agent file |
| Skill | What reusable method is used? | `skills/` |
| Capability | What is the actor equipped to do? | `agents/manifest.json` |
| Authority | What decisions may the actor make? | `agents/manifest.json` |
| Execution permission | Is this operation allowed, approval-required, or denied? | canonical agent OpenCode permission frontmatter + native OpenCode runtime |
| Model routing | What inference resource executes the role? | `profiles/*.json` selected by machine config or explicit override |
| Evidence | What actually happened? | runtime evidence/ledger/activity records |
| Review | Was the result independently accepted? | reviewer workflow, separate from implementation |
| Release identity | What immutable source is installed? | staged `RELEASE.json` owned by deployment |

Capability is not authority. Permission is not authority. Evidence is not judgment. Implementation is not independent acceptance.

## Approval model

Ocode uses OpenCode native permission UI as the single interactive approval owner for governed Bash execution. The old duplicate approval mechanisms (`request_effect`, `ocode effect`, custom `Allow once?` prompts, separate approval ledger, duplicate argv execution) are retired architecture.

Bounded repository inspection is explicitly frictionless for governed roles, including appropriate forms of:

```text
pwd
ls
rg
grep
git status
git diff
git log
git show
git rev-parse
```

Consequential operations remain `ASK` where the role is allowed to request them. Structural denials remain `DENY`; they do not become approvable merely to reduce friction.

The OpenCode `1.18.21` permission characterization in `docs/architecture/opencode-1.18.21-permission-contract.md` qualifies only the native Bash properties Ocode projects. In particular, wildcard observation rules require trailing structural redirection denials; do not generalize the record to untested tools or shell grammar.

## Agent topology

The manifest currently governs nine roles:

- `orchestrator` — human-facing coordinator and primary approval-routing owner;
- `planner` — implementation planning;
- `coder` — bounded implementation;
- `wayfinder` — structured uncertainty/repository-navigation work;
- `researcher` — external/current research;
- `verifier` — independent validation evidence;
- `reviewer` — independent read-only review/acceptance judgment;
- `judge` — scarce independent second opinion;
- `committer` — semantic closeout preparation; deterministic runtime owns Git mutation.

A role exists because it currently has a governed contract, not because role count is a target. Reusable procedures belong in skills; independent review must not collapse into implementation.

## Model and provider routing

Canonical agents do not embed provider/model policy. Profiles bind roles to model resources:

```bash
ocode profile
ocode profile diff free hybrid
```

Machine default:

```text
~/.config/ocode/config.json
```

Example:

```json
{
  "profile": "hybrid",
  "freellmapi": {
    "base_url": "http://127.0.0.1:3001/v1"
  },
  "closeout": {
    "push": false
  }
}
```

An explicit `--profile` is a per-invocation override and does not persist.

## Customization boundaries

Common changes should stay out of runtime internals:

- model/provider selection: `profiles/*.json` and machine config;
- FreeLLMAPI endpoint: `~/.config/ocode/config.json`;
- agent capability/authority: `agents/manifest.json`;
- native execution permission: canonical `agents/*.md` frontmatter;
- reusable methods: `skills/`;
- project-specific behavior/context: project `.opencode/` artifacts/config supported by OpenCode/Ocode.

When changing permission policy, preserve the distinction between configured projection and observed OpenCode runtime behavior. When changing authority, edit the authority owner rather than using permission as a proxy.

## Qualification and evidence

Qualification preserves the following order:

```text
controlled context
  -> method execution
  -> immutable execution evidence
  -> acceptance evaluation
```

Execution evidence is not an agent report. Report-generation failure must not erase already captured execution evidence.

Activity/work-view state should remain a projection of authoritative execution/work events. Presentation is an observer, not an execution authority.

## Development workflow

```bash
npm ci
npm test
npm run doctor
```

Focused checks remain available through `test:*` scripts. Historical milestone acceptance commands remain in `package.json` while their evidence is still useful; they should not be treated as permanent product UX.

To promote a tested clean checkout:

```bash
ocode version
ocode update
ocode version
```

To restore the most recent installed backup:

```bash
ocode rollback
ocode version
```

## Repository map

```text
agents/                       governed role inventory + canonical OpenCode agent files
profiles/                     provider-neutral role binding policy
skills/                       reusable methods and qualification material
opencode-config/              Ocode-owned OpenCode configuration projection
packages/harness-runtime/     execution, governance, evidence, deployment, CLI runtime
packages/orientation/         project orientation
installer/                    staged bootstrap/promotion
scripts/                      development, qualification, historical acceptance helpers
test/                         deterministic behavioral tests
docs/                         current architecture + retained historical evidence
VERSION                       semantic version only
```

See `docs/installation.md` for installation details and `docs/architecture/` for the authority, approval, OpenCode, qualification, and runtime contracts.
