# Ocode binding profiles

Binding profiles own only semantic-role to OpenCode provider/model policy.
Stable provider definitions remain in `opencode-config/opencode.json`; machine-local
profile selection and endpoint settings remain in `~/.config/ocode/config.json`;
authentication remains in OpenCode's credential store.

M2 establishes schema version 1 and the deterministic overlay builder. M3 will add
the production `free.json` and `hybrid.json` policies after choosing the complete
role bindings. A profile has this shape:

```json
{
  "schema_version": 1,
  "name": "example",
  "bindings": {
    "planner": "provider/model"
  }
}
```

The runtime converts the bindings to `agent.<role>.model` entries in
`OPENCODE_CONFIG_CONTENT`. Profiles do not define providers, credentials, routing,
fallback, health scoring, permissions, prompts, or agent authority.
