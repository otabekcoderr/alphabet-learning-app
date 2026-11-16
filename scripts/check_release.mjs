import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reviewCsvPath = path.join(projectRoot, 'audio_review.csv');

if (!fs.existsSync(reviewCsvPath)) {
  console.error('ERROR: audio_review.csv not found.');
  process.exit(1);
}

const raw = fs.readFileSync(reviewCsvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

function parseCsvRow(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

const header = parseCsvRow(lines[0] ?? '');
const fileIdx = header.indexOf('file');
const statusIdx = header.indexOf('status');

if (fileIdx === -1 || statusIdx === -1) {
  console.error('ERROR: audio_review.csv must contain file and status columns.');
  process.exit(1);
}

const temporaryPresent = [];
for (let i = 1; i < lines.length; i++) {
  const row = parseCsvRow(lines[i]);
  const relPath = (row[fileIdx] ?? '').trim();
  const status = (row[statusIdx] ?? '').trim().toLowerCase();

  if (status.includes('temporary') && relPath.startsWith('public/audio/')) {
    const absPath = path.join(projectRoot, relPath);
    if (fs.existsSync(absPath)) {
      temporaryPresent.push(relPath);
    }
  }
}

if (temporaryPresent.length > 0) {
  console.error(
    `RELEASE CHECK FAILED: ${temporaryPresent.length} temporary audio file(s) still present under public/audio/:`,
  );
  for (const f of temporaryPresent.slice(0, 15)) {
    console.error(`  - ${f}`);
  }
  if (temporaryPresent.length > 15) {
    console.error(`  ... and ${temporaryPresent.length - 15} more.`);
  }
  process.exit(1);
}

console.log('RELEASE CHECK PASSED: no temporary audio files exist under public/audio/.');
