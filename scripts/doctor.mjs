#!/usr/bin/env node
// Source-checkout convenience entrypoint. The installed `ocode doctor`
// command executes the same runtime-owned implementation from release bytes.
import { runDoctor } from '../packages/harness-runtime/lib/doctor.mjs';

const report = runDoctor({ projectDir: process.cwd(), environment: process.env });
console.log(report.text);
process.exitCode = report.healthy ? 0 : 1;
