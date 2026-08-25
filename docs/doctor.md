# Doctor

Run:

```bash
node scripts/doctor.mjs
```

Doctor is a fast structural and availability check. It verifies:

- OpenCode, Node.js, and Git availability;
- the tested OpenCode 1.18.21 version (another version is a warning with an M2 smoke recommendation);
- the deterministic Design C runtime-overlay builder;
- the active production profile, both complete profile fingerprints, and manifest-derived role coverage;
- provider-neutral canonical agents and deterministic agent-contract parsing/fingerprinting;
- normalized manifest authority and OpenCode permissions;
- installed managed agents, runtime files, doctrine, launchers, and Git exclusions;
- source/install agent fingerprint agreement when repository source is available;
- secret-safe private-auth state without printing key material;
- FreeLLMAPI visibility/health through OpenCode;
- OpenAI model visibility when the machine profile is `hybrid`;
- Ocode machine settings and deterministic runtime primitives.

Doctor does not perform model inference. Run the heavier boundary when runtime compatibility must be established:

```bash
npm run acceptance:m2
npm run acceptance:m3
```

`OCODE_DOCTOR_SKIP_NETWORK=1` skips provider availability checks in isolated tests. It does not make M2 or M3 acceptance optional. OpenAI catalog visibility is required only when the active machine profile is `hybrid`.
