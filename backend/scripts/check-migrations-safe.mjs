#!/usr/bin/env node
/**
 * Block obviously destructive SQL migrations from shipping unchecked.
 * Usage: node backend/scripts/check-migrations-safe.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

const BLOCK_PATTERNS = [
  { re: /\bDROP\s+DATABASE\b/i, label: 'DROP DATABASE' },
  { re: /\bDROP\s+SCHEMA\b/i, label: 'DROP SCHEMA' },
  { re: /\bTRUNCATE\s+TABLE\b/i, label: 'TRUNCATE TABLE' },
  { re: /\bDELETE\s+FROM\s+users\b(?![\s\S]*\bWHERE\b)/i, label: 'DELETE FROM users without WHERE' },
  { re: /\bDELETE\s+FROM\s+bookings\b(?![\s\S]*\bWHERE\b)/i, label: 'DELETE FROM bookings without WHERE' }
];

const WARN_PATTERNS = [
  { re: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE (review carefully)' },
  { re: /\bDROP\s+COLUMN\b/i, label: 'DROP COLUMN (review carefully)' }
];

if (!fs.existsSync(migrationsDir)) {
  console.log('No migrations directory — OK');
  process.exit(0);
}

const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
let blocked = false;
let warnings = 0;

for (const file of files) {
  const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  for (const { re, label } of BLOCK_PATTERNS) {
    if (re.test(content)) {
      console.error(`BLOCKED ${file}: ${label}`);
      blocked = true;
    }
  }
  for (const { re, label } of WARN_PATTERNS) {
    if (re.test(content)) {
      console.warn(`WARN ${file}: ${label}`);
      warnings += 1;
    }
  }
}

if (blocked) {
  console.error('\nMigration safety check FAILED.');
  process.exit(1);
}

console.log(`Migration safety check OK (${files.length} files, ${warnings} warnings).`);
