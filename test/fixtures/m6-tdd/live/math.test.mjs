import assert from 'node:assert/strict';
import { isEven } from './math.mjs';
assert.equal(isEven(4), true);
assert.equal(isEven(5), false);
