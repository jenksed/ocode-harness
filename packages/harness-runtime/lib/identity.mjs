import { randomUUID } from 'node:crypto';

export function generateTaskId() {
  return randomUUID();
}

export function generateRunId() {
  return randomUUID();
}