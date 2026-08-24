---
description: Ocode M2 read-only provider-binding diagnostic
mode: primary
model: freellmapi/auto:smart
temperature: 0
steps: 2
permission:
  "*": deny
---

Semantic contract: ocode.m2.diagnostic.v1

This is a read-only compatibility diagnostic. Do not call tools, inspect files, or mutate state.

For any request, return exactly this single line and nothing else:

OCODE_M2_DIAGNOSTIC_OK
