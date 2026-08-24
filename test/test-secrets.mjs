#!/usr/bin/env node
/**
 * test-secrets.mjs
 * Verify no credentials in committed files
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

console.log('=== Test Secrets ===\n');

const secrets = [
  'api_key',
  'apikey',
  'secret',
  'password',
  'token',
  'credentials',
  'private_key',
];

const extensions = new Set(['.json', '.md', '.js', '.mjs', '.ts', '.txt']);

console.log('Searching for potential secrets in source files...\n');

const foundSecrets = [];

try {
  const files = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter(file => extensions.has(file.slice(file.lastIndexOf('.'))));

  for (const file of files) {
    const filePath = join(repoRoot, file);

    // Skip test files
    if (file.includes('test.')) {
      continue;
    }

    // Skip node_modules
    if (file.includes('node_modules')) {
      continue;
    }

    // Skip .git directories
    if (file.includes('.git')) {
      continue;
    }

    // Skip backup files
    if (file.includes('backup')) {
      continue;
    }

    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf8');

      for (const secret of secrets) {
        // Check for API key patterns
        if (content.includes(`"${secret}:`) ||
            content.includes(`'${secret}:`) ||
            content.includes(`"${secret}":`) ||
            content.includes(`'${secret}':`)) {
          // Check if it's actually a secret value (not just the key name)
          // Look for patterns like "key": "value" or key: "value"
          const regex = new RegExp(`${secret}\\s*[:=]\\s*["\']([^"\']+)["\']`, 'i');
          const match = content.match(regex);

          if (match && match[1] && match[1].length > 0) {
            // Check if it looks like a real secret (not a placeholder)
            const value = match[1];
            const isPlaceholder = value.includes('{env:') ||
                                 value.includes('${') ||
                                 value.includes('http') ||
                                 value.includes('example.com') ||
                                 value.includes('localhost');

            if (!isPlaceholder) {
              foundSecrets.push({
                file,
                secret,
                value: value.substring(0, 50) + (value.length > 50 ? '...' : ''),
              });
            }
          }
        }
      }
    }
  }
} catch (error) {
  console.error('Error scanning tracked files:', error.message);
  process.exit(1);
}

const doctorSource = readFileSync(join(repoRoot, 'scripts', 'doctor.mjs'), 'utf8');
if (doctorSource.includes('substring') && doctorSource.includes('FREELLMAPI_API_KEY')) {
  foundSecrets.push({
    file: 'scripts/doctor.mjs',
    secret: 'FREELLMAPI_API_KEY',
    value: 'doctor must not print partial key material',
  });
}

// Report results
if (foundSecrets.length === 0) {
  console.log('✓ No secrets found in source files');
  console.log('\nNote: Secrets should use placeholders like:');
  console.log('  - {env:VARIABLE_NAME}');
  console.log('  - ${VARIABLE_NAME}');
  console.log('  - local non-secret URLs configured through ~/.config/ocode/config.json');
  process.exit(0);
} else {
  console.error('✗ Found potential secrets in source files:\n');

  for (const found of foundSecrets) {
    console.error(`  File: ${found.file}`);
    console.error(`  Secret: ${found.secret}`);
    console.error(`  Value: ${found.value}`);
    console.error('');
  }

  console.error('Please remove or replace these secrets with placeholders.');
  process.exit(1);
}
