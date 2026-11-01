// Licensing gate, per the Spec Kitty Repo Licensing Policy: a distributed repo carries
// the canonical MIT text with "Spec Kitty, Inc." as the copyright holder, and the
// package metadata names the same entity. Fails CI if either drifts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// sha256 of the canonical MIT text after the copyright line (grant + disclaimer).
const MIT_BODY_SHA256 = '21a76c19ae398e37fc00bca26e6850feee362e8188f8507ad44a53475ee62c33';

test('LICENSE is MIT with Spec Kitty, Inc. as the only copyright holder', () => {
  const lines = read('LICENSE').split('\n');
  assert.equal(lines[0], 'MIT License');
  assert.match(lines[2], /^Copyright \(c\) \d{4} Spec Kitty, Inc\.$/);
  const body = lines.slice(3).join('\n');
  assert.equal(createHash('sha256').update(body).digest('hex'), MIT_BODY_SHA256, 'the MIT grant and disclaimer must stay verbatim');
});

test('package metadata names the same entity and license', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.author, 'Spec Kitty, Inc.');
  assert.ok(pkg.files.includes('LICENSE'), 'LICENSE ships in the published package');
});
