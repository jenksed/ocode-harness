---
description: Valid M4A reviewer fixture
mode: subagent
permission:
  edit: deny
  bash:
    "*": deny
    "git diff": allow
---

Evaluate the supplied repository change without modifying it.
