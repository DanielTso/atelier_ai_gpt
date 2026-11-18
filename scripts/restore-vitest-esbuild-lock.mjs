// Restore vitest's nested esbuild entries in package-lock.json after an npm 11
// install drops them (npm 11 prunes node_modules/vitest/node_modules/esbuild and
// its @esbuild/* platform packages; CI's npm 10 then fails `npm ci`).
//
// Usage (from the repo root, BEFORE the dependency change):
//   git show HEAD:package-lock.json > ../lock.before.json
//   ...run the npm install / update...
//   node scripts/restore-vitest-esbuild-lock.mjs ../lock.before.json
// Then verify both: `npm ci --dry-run` and `npx -y npm@10 ci --dry-run`.
// The entries are re-inserted right after the key that preceded them in the old
// lockfile (normally `node_modules/@vitest/mocker`), keeping the file's EOLs.
import fs from 'node:fs'

const beforePath = process.argv[2]
if (!beforePath) {
  console.error('usage: node scripts/restore-vitest-esbuild-lock.mjs <old-package-lock.json>')
  process.exit(2)
}
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
const curText = fs.readFileSync('package-lock.json', 'utf8')
const eol = curText.includes('\r\n') ? '\r\n' : '\n'
const cur = JSON.parse(curText)
const isTarget = (k) => k === 'node_modules/vitest/node_modules/esbuild' || k.startsWith('node_modules/vitest/node_modules/@esbuild/')
const bKeys = Object.keys(before.packages)
const targets = bKeys.filter(isTarget)
if (targets.length === 0) {
  console.error('the old lockfile has no nested vitest esbuild entries to restore')
  process.exit(1)
}
const firstIdx = bKeys.indexOf(targets[0])
const anchor = bKeys[firstIdx - 1]
console.log('targets', targets.length, 'anchor', anchor, 'anchor in cur', anchor in cur.packages)
console.log('targets contiguous', targets.every((k, i) => bKeys[firstIdx + i] === k))
if (!(anchor in cur.packages)) process.exit(1)
const out = {}
for (const k of Object.keys(cur.packages)) {
  if (isTarget(k)) throw new Error('already present ' + k)
  out[k] = cur.packages[k]
  if (k === anchor) for (const t of targets) out[t] = before.packages[t]
}
cur.packages = out
let s = JSON.stringify(cur, null, 2) + '\n'
if (eol === '\r\n') s = s.replace(/\n/g, '\r\n')
fs.writeFileSync('package-lock.json', s)
const t = before.packages['node_modules/vitest/node_modules/esbuild']
console.log('esbuild', t.version, 'optional', t.optional, 'extraneous', t.extraneous)
