#!/usr/bin/env node
// Historical invariant: timestamp backup copy.  Replacement invariant:
// rollback validates previous and switches immutable release pointers.
import './test-phase3-release-store.mjs';
