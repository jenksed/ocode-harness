# Ocode binding profiles

Binding profiles own only semantic-role to OpenCode provider/model policy.
Stable provider definitions remain in `opencode-config/opencode.json`; machine-local
profile selection and endpoint settings remain in `~/.config/ocode/config.json`;
authentication remains in OpenCode's credential store.

Schema version 1 and the deterministic overlay builder are production contracts.
`free.json` and `hybrid.json` are the two initial production policies. A profile has
this shape:

```json
{
  "schema_version": 1,
  "name": "example",
  "policy_version": 1,
  "bindings": {
    "planner": "provider/model"
  }
}
```

The runtime converts the bindings to `agent.<role>.model` entries in
`OPENCODE_CONFIG_CONTENT`. Profiles do not define providers, credentials, routing,
fallback, health scoring, permissions, prompts, or agent authority.

Every role in `agents/manifest.json` must have exactly one binding and profiles may
not name unknown roles. There is no inheritance or implicit provider default.
