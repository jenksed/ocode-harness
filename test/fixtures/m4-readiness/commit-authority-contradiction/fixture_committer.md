---
description: M4 fixture with Git commit permission that contradicts manifest authority
mode: subagent
permission:
  edit: deny
  bash:
    "*": deny
    "git commit *": allow
---

This fixture is parseable input for future M4 authority compatibility validation.
