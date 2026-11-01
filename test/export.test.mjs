import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'bin', 'brain-to-dockitty.mjs');
const fixture = join(root, 'test', 'fixtures', 'brain');
const urlArgs = [
  '--source-url', 'repo/=https://example.com/repo/blob/main/',
  '--source-url', '^issues/([^/]+)/(\\d+)-.*$=https://example.com/$1/issues/$2',
];

const tmpDirs = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'b2d-'));
  tmpDirs.push(d);
  return d;
};
after(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function run(args) {
  const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return JSON.parse(out);
}
function exportTo(extra = []) {
  const dir = tmp();
  const stats = run([fixture, '--out', join(dir, 'docs'), ...urlArgs, ...extra]);
  return { docs: join(dir, 'docs'), dir, stats };
}
function page(docs, rel) {
  const text = readFileSync(join(docs, rel), 'utf8');
  const end = text.indexOf('\n---', 3);
  return { fm: YAML.parse(text.slice(3, end)), body: text.slice(end + 4) };
}

test('exports ratified foundation nodes only, one section per charter role label', () => {
  const { docs, stats } = exportTo();
  assert.equal(stats.pages, 4);
  assert.deepEqual(stats.counts, { frame: 1, move: 1, selector: 1, commitment: 1 });
  for (const rel of ['axes/release-process.md', 'decisions/two-approvals.md', 'plays/cut-on-tuesday.md', 'rules/hotfix-rule.md']) {
    assert.ok(existsSync(join(docs, rel)), rel);
  }
  assert.ok(!existsSync(join(docs, 'plays/draft-idea.md')), 'drafts never leave the Brain');
  assert.ok(!existsSync(join(docs, 'decisions/team-a-rule.md')), 'other scopes are opt-in');
  const registry = YAML.parse(readFileSync(join(docs, '_meta/charter.yaml'), 'utf8'));
  assert.deepEqual(registry.sections.entries.map((e) => e.label), ['Context', 'Axes', 'Plays', 'Rules', 'Decisions']);
});

test('maps lifecycle, ratification, typed edges and provenance', () => {
  const { docs, stats } = exportTo();
  const { fm, body } = page(docs, 'decisions/two-approvals.md');
  assert.equal(fm.type, 'Decision');
  assert.equal(fm.kind, 'Reference');
  assert.equal(fm.doc_status, 'active');
  assert.deepEqual(fm.verified, [{ by: 'human:bob', at: '2026-10-03T10:00:00Z' }]);
  assert.deepEqual(fm.related, [{ ref: 'axes/release-process', note: 'applies-under' }]);
  assert.equal(stats.droppedEdges, 1, 'an edge to a missing node is dropped, not emitted as a broken ref');
  assert.equal(stats.unresolvedSources, 1);
  assert.deepEqual(fm.external_references, [
    { url: 'https://example.com/repo/blob/main/docs/release.md', title: 'repo/docs/release.md', note: 'drafted from (parts 1, 3)' },
    { url: 'https://example.com/repo/issues/42', title: 'issues/repo/42-freeze-window.md', note: 'drafted from' },
  ]);
  assert.equal(fm.sources.length, 2);
  assert.equal(fm.brain.role, 'commitment');
  assert.equal(fm.brain.role_label, 'decision');
  assert.match(body, /\[Cut releases on Tuesdays\]\(\.\.\/plays\/cut-on-tuesday\.md\)/);
});

test('axis pages list what applies under them', () => {
  const { docs } = exportTo();
  const { body } = page(docs, 'axes/release-process.md');
  assert.match(body, /## What applies under this axis/);
  assert.match(body, /### Decisions \(1\)/);
  assert.match(body, /### Plays \(1\)/);
  assert.match(body, /### Rules \(1\)/);
});

test('llms.txt lists axes and decisions by default; --llms widens it', () => {
  const { docs } = exportTo();
  assert.equal(page(docs, 'plays/cut-on-tuesday.md').fm.agent?.discoverable, false);
  assert.equal(page(docs, 'decisions/two-approvals.md').fm.agent, undefined);
  const wide = exportTo(['--llms', 'frame,move,selector,commitment']);
  assert.equal(page(wide.docs, 'plays/cut-on-tuesday.md').fm.agent, undefined);
});

test('--scope adds scopes beyond foundation', () => {
  const { docs, stats } = exportTo(['--scope', 'foundation', '--scope', 'team-a']);
  assert.equal(stats.pages, 5);
  assert.equal(page(docs, 'decisions/team-a-rule.md').fm.brain.scope, 'team-a');
});

test('refuses a Brain format version it does not know', () => {
  const dir = tmp();
  cpSync(fixture, join(dir, 'brain'), { recursive: true });
  const desc = join(dir, 'brain', '.brainkitty', 'brain.json');
  writeFileSync(desc, JSON.stringify({ ...JSON.parse(readFileSync(desc, 'utf8')), schemaVersion: 99 }));
  const r = spawnSync(process.execPath, [cli, join(dir, 'brain'), '--out', join(dir, 'docs')], { encoding: 'utf8' });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /unsupported Brain schemaVersion 99/);
});

test('--site scaffolds a hubs-only site and never overwrites existing files', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'package.json'), '{"name":"mine"}\n');
  const stats = run([fixture, '--site', dir, ...urlArgs]);
  assert.ok(!stats.scaffolded.includes('package.json'));
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), '{"name":"mine"}\n');
  const config = readFileSync(join(dir, 'astro.config.mjs'), 'utf8');
  assert.match(config, /"link":"\/decisions\/"/);
  assert.ok(existsSync(join(dir, 'docs', 'decisions', 'two-approvals.md')));
  assert.ok(existsSync(join(dir, 'src', 'pages', 'api', 'pages', '[...slug].json.ts')));
});
