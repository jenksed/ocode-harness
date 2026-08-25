# Production execution profiles

Ocode profiles are deterministic semantic-role → OpenCode provider/model policy. They do not define provider credentials, choose FreeLLMAPI backends, score models, or implement fallback.

| State | Owner | Location |
| --- | --- | --- |
| Governed role identity and authority metadata | Ocode | `agents/manifest.json` |
| Semantic instructions and OpenCode permissions | Ocode | `agents/*.md` |
| Role → provider/model policy | Ocode | `profiles/free.json`, `profiles/hybrid.json` |
| Machine default | operator | `~/.config/ocode/config.json` |
| Provider catalog, authentication, and execution | OpenCode | OpenCode configuration/credential store |
| Free route backend selection | FreeLLMAPI | `auto:*` router |

The machine default is selected by `profile` in the existing machine config. A launch override has precedence and is never persisted:

```bash
ocode
ocode --profile free
ocode --profile hybrid
```

The free profile binds all eight governed roles to the current FreeLLMAPI execution profiles: `auto:default`, `auto:planning`, `auto:coding`, `auto:research`, `auto:verification`, `auto:review`, `auto:reasoning`, and `auto:utility`. The hybrid profile uses `openai/gpt-5.6-sol` for Planner, Reviewer, and Judge and the corresponding FreeLLMAPI routes for the remaining roles. `auto:wayfinder` is catalogued for future use but Wayfinder is not a governed M3 role. Model changes belong only in these profiles.

Inspect policy without inference:

```bash
ocode profile
ocode profile explain planner
ocode profile explain reviewer
ocode profile diff free hybrid
```

Each profile carries `schema_version`, `name`, `policy_version`, and explicit `bindings`. Validation rejects missing roles, unknown roles, malformed model references, unsupported schemas, and unknown fields. Before normal launch, Ocode confirms every requested model is visible in the corresponding OpenCode catalog. Failure denies execution; Ocode never substitutes another provider/model.

If `OPENCODE_CONFIG_CONTENT` already exists, Ocode parses it and preserves unrelated keys and unrelated properties on governed agent entries. It owns only `agent.<governed-role>.model`. Malformed or structurally incompatible inline configuration fails closed.

For bounded governed execution, an `ExecutionResolution` records the semantic contract fingerprint separately from profile policy. Sanitized OpenCode session export supplies the effective binding. Reconciliation is `MATCH`, `MISMATCH`, or `UNKNOWN`; mismatch is a policy failure, not an invitation to bypass managed configuration.
