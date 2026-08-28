#!/usr/bin/env node
// Historical invariant: staged source copy + backup.  Replacement invariant:
// artifact-only update installs a verified immutable release and switches current.
import './test-phase3-release-store.mjs';
