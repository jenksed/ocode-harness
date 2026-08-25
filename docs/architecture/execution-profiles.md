# Execution profiles and provenance

M3 productionizes the M2-proven Design C seam:

```text
machine profile or --profile override
  → strict profile + manifest validation
  → exact role bindings and availability checks
  → ownership-aware OPENCODE_CONFIG_CONTENT overlay
  → normal OpenCode interactive runtime or bounded opencode run
  → sanitized session export
  → requested/effective reconciliation
  → existing project run ledger
```

Canonical agents are provider-neutral. Their stable semantic contract fingerprint covers role ID, semantic body, provider-neutral agent settings, declared OpenCode permissions, and manifest authority/governance metadata. Profile names, provider IDs, and model IDs are excluded.

`ExecutionResolution` schema version 1 is pre-inference control data:

```json
{
  "schema_version": 1,
  "subject": {
    "role": "reviewer",
    "contract_fingerprint": "sha256"
  },
  "execution_policy": {
    "profile": "hybrid",
    "policy_version": 1,
    "profile_fingerprint": "sha256",
    "requested_model": "openai/gpt-5.6-sol",
    "binding_source": "profiles/hybrid.json",
    "fallback": "deny"
  },
  "validation": {
    "status": "PASS"
  }
}
```

The subject, execution policy, and validation namespaces let M4 add a separate governance namespace without replacing M3 consumers. M3 only parses and normalizes authority and permission reality; it does not decide whether combinations are allowed.

The existing ledger adds one optional `execution_provenance` object with the resolution facts, effective model when observed, reconciliation state, success, and failure classification. `ocode explain --run <run-id>` is the immediate consumer. The execution path consumes the same fields to fail a mismatch. No analytics store was added.

OpenCode still owns authentication, catalogs, and invocation. FreeLLMAPI still owns the underlying provider/model selected by `auto:*`. Ocode contains no inference router and performs no cross-provider fallback.

OpenCode 1.18.21 honors `opencode run --agent <role>` only when the selected agent is primary. Bounded direct execution therefore adds `mode: primary` for only that explicitly invoked role in the ephemeral overlay. The normal interactive launcher adds only model bindings, and canonical agent primary/subagent modes remain unchanged.
