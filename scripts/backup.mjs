#!/usr/bin/env node
/**
 * backup.mjs
 * backup/rollback utilities for ocode-harness
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, readdir, statSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
  backupDir: join(homedir(), '.local', 'share', 'ocode-harness', 'backups'),
  opencodeConfig: join(homedir(), '.config', 'opencode', 'opencode.json'),
};

function listBackups() {
  console.log('=== ocode-harness Backups ===\n');

  if (!existsSync(CONFIG.backupDir)) {
    console.log('No backups found');
    return [];
  }

  const backups = [];

  try {
    const files = readdir(CONFIG.backupDir);

    for (const file of files) {
      if (file.endsWith('.json') && file.startsWith('opencode-backup-')) {
        const filePath = join(CONFIG.backupDir, file);
        const stats = statSync(filePath);

        backups.push({
          name: file,
          path: filePath,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }
  } catch (err) {
    console.error('Error reading backups directory:', err.message);
    return [];
  }

  // Sort by modification time (newest first)
  backups.sort((a, b) => b.modified - a.modified);

  if (backups.length === 0) {
    console.log('No backups found');
    return [];
  }

  console.log(`Found ${backups.length} backup(s):\n`);

  for (let i = 0; i < backups.length; i++) {
    const backup = backups[i];
    console.log(`${i + 1}. ${backup.name}`);
    console.log(`   Size: ${backup.size} bytes`);
    console.log(`   Modified: ${backup.modified.toISOString()}`);
    console.log(`   Path: ${backup.path}`);
    console.log('');
  }

  return backups;
}

function restoreBackup(backupIndex) {
  console.log('=== Restoring Backup ===\n');

  const backups = listBackups();

  if (backups.length === 0) {
    console.error('No backups to restore');
    process.exit(1);
  }

  if (backupIndex < 0 || backupIndex >= backups.length) {
    console.error(`Invalid backup index: ${backupIndex}`);
    console.error(`Valid indices: 0 to ${backups.length - 1}`);
    process.exit(1);
  }

  const backup = backups[backupIndex];
  console.log(`Restoring: ${backup.name}\n`);

  // Read backup content
  try {
    const backupContent = readFileSync(backup.path, 'utf8');
    const backupData = JSON.parse(backupContent);

    // Write to opencode config
    mkdirSync(join(homedir(), '.config', 'opencode'), { recursive: true });
    writeFileSync(CONFIG.opencodeConfig, backupContent, 'utf8');

    console.log('✓ Backup restored successfully');
    console.log(`  Configuration: ${CONFIG.opencodeConfig}`);
    console.log('\nNext steps:');
    console.log('  1. Review the restored configuration');
    console.log('  2. Run "ocode-harness doctor" to verify the installation');
    console.log('  3. If needed, make additional changes');

  } catch (err) {
    console.error('✗ Failed to restore backup:', err.message);
    process.exit(1);
  }
}

function createBackup() {
  console.log('=== Creating Backup ===\n');

  if (!existsSync(CONFIG.opencodeConfig)) {
    console.error('No existing opencode configuration to backup');
    console.log('Run: ocode-harness install to create the initial configuration');
    process.exit(1);
  }

  // Read existing config
  const existingConfig = JSON.parse(readFileSync(CONFIG.opencodeConfig, 'utf8'));

  // Create backup
  const backupFile = join(CONFIG.backupDir, `opencode-backup-${Date.now()}.json`);

  mkdirSync(CONFIG.backupDir, { recursive: true });
  writeFileSync(backupFile, JSON.stringify(existingConfig, null, 2), 'utf8');

  const stats = statSync(backupFile);

  console.log('✓ Backup created successfully');
  console.log(`  File: ${backupFile}`);
  console.log(`  Size: ${stats.size} bytes`);
  console.log(`  Modified: ${stats.mtime.toISOString()}`);
  console.log('\nYou can restore this backup using:');
  console.log(`  ocode-harness restore ${backupFile.split('/').pop()}`);
}

function deleteBackup(backupIndex) {
  console.log('=== Deleting Backup ===\n');

  const backups = listBackups();

  if (backups.length === 0) {
    console.error('No backups to delete');
    process.exit(1);
  }

  if (backupIndex < 0 || backupIndex >= backups.length) {
    console.error(`Invalid backup index: ${backupIndex}`);
    console.error(`Valid indices: 0 to ${backups.length - 1}`);
    process.exit(1);
  }

  const backup = backups[backupIndex];
  console.log(`Deleting: ${backup.name}\n`);

  try {
    rmSync(backup.path);
    console.log('✓ Backup deleted successfully');
  } catch (err) {
    console.error('✗ Failed to delete backup:', err.message);
    process.exit(1);
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: ocode-harness backup <command>');
    console.log('');
    console.log('Commands:');
    console.log('  list          List all backups');
    console.log('  create        Create a new backup');
    console.log('  restore <n>   Restore backup by index (0-indexed)');
    console.log('  delete <n>    Delete backup by index (0-indexed)');
    console.log('');
    console.log('Examples:');
    console.log('  ocode-harness backup list');
    console.log('  ocode-harness backup create');
    console.log('  ocode-harness backup restore 0');
    console.log('  ocode-harness backup delete 1');
    process.exit(1);
  }

  const command = args[0];

  switch (command) {
    case 'list':
      listBackups();
      break;
    case 'create':
      createBackup();
      break;
    case 'restore':
      if (args.length < 2) {
        console.error('Error: restore command requires an index');
        console.log('Usage: ocode-harness backup restore <index>');
        process.exit(1);
      }
      const restoreIndex = parseInt(args[1], 10);
      restoreBackup(restoreIndex);
      break;
    case 'delete':
      if (args.length < 2) {
        console.error('Error: delete command requires an index');
        console.log('Usage: ocode-harness backup delete <index>');
        process.exit(1);
      }
      const deleteIndex = parseInt(args[1], 10);
      deleteBackup(deleteIndex);
      break;
    default:
      console.error(`Error: unknown command: ${command}`);
      console.log('Usage: ocode-harness backup <command>');
      process.exit(1);
  }
}

main();
