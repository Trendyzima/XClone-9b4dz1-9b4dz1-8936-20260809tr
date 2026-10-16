import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/flutter-clients.yml', 'utf8');
const lock = fs.readFileSync('mobile/pubspec.lock', 'utf8');
const pin = workflow.match(/flutter-version:\s*['"]?([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
const constraint = lock.match(/^\s+flutter:\s*['"]([^'"]+)['"]\s*$/m)?.[1];

function tuple(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error('Unsupported Flutter/Dart version format: ' + version);
  return match.slice(1).map(Number);
}
function compare(a, b) {
  const left = tuple(a), right = tuple(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
  }
  return 0;
}
if (!pin) throw new Error('Flutter CI version pin is missing from flutter-clients.yml');
if (!constraint) throw new Error('Flutter SDK constraint is missing from mobile/pubspec.lock');
const lower = constraint.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1];
const upper = constraint.match(/<\s*(\d+\.\d+\.\d+)/)?.[1];
if (!lower) throw new Error('Could not parse lower Flutter SDK constraint: ' + constraint);
if (compare(pin, lower) < 0 || (upper && compare(pin, upper) >= 0)) {
  throw new Error(`Flutter CI pins ${pin}, outside pubspec.lock constraint ${constraint}`);
}
console.log(`Flutter SDK pin ${pin} satisfies pubspec.lock constraint ${constraint}.`);
