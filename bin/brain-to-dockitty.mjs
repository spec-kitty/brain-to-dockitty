#!/usr/bin/env node
/**
 * brain-to-dockitty: export a Brain's ratified content as a DocKitty docs/ tree.
 *
 * Reads only the Brain's markdown (the source of truth; the SQLite index is never
 * opened) and writes a tree that doc-kitty's frontmatter gate and site build accept:
 *
 *   docs/README.md                  bundle root (okf_version 0.2)
 *   docs/_meta/charter.yaml         section registry: one section per role, labelled
 *                                   with the Brain charter's role labels
 *   docs/context/charter.md         the Brain's charter
 *   docs/<role-section>/README.md   hub per role
 *   docs/<role-section>/<id>.md     one page per ratified node
 *
 * Scopes beyond foundation are opt-in (--scope). When several are exported, a scoped
 * page says which scope it applies in, and overrides (an `overrides` edge up the
 * declaring node's scope chain, or an entity in overrides/) show as callouts on
 * both the overriding and the overridden page. docs/brain-format.md lists exactly
 * what is read.
 *
 * With --site <dir>, the tree goes to <dir>/docs and a minimal doc-kitty site is
 * scaffolded around it (astro.config.mjs with a hubs-only sidebar, content config,
 * llms.txt / RSS / agent-API routes). Existing site files are left alone.
 *
 * Usage:
 *   brain-to-dockitty <brain-dir> (--out <docs-dir> | --site <site-dir>) [--scope foundation]
 *     [--source-url <prefix>=<url-prefix>]...    map source paths to links; a prefix starting
 *                                                with ^ is a regex, $1.. in the URL are its groups
 *     [--llms <role,...>]                         roles listed in llms.txt / agent API
 *                                                (default: frame,commitment)
 *     [--title <site title>] [--site-url <url>] [--base </path>] [--toolkit <version spec>]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

const VERSION = '0.2.0';
const SUPPORTED_SCHEMA = [1];
const ROLES = ['frame', 'move', 'selector', 'commitment'];
const ROLE_ORDER = { frame: 10, commitment: 20, selector: 30, move: 40 };
// Canonical DocKitty kinds, so the gate passes without vocabulary warnings; the
// Brain role travels in the `brain` block and the section.
const ROLE_KIND = { frame: 'Explanation', move: 'How-To', selector: 'Reference', commitment: 'Reference' };
const STATUS = { ratified: 'active', dated: 'superseded', retired: 'deprecated' };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    site: { type: 'string' },
    scope: { type: 'string', multiple: true },
    'source-url': { type: 'string', multiple: true },
    llms: { type: 'string' },
    title: { type: 'string' },
    'site-url': { type: 'string', default: 'https://example.invalid' },
    base: { type: 'string' },
    toolkit: { type: 'string', default: '^0.5.0' },
    clean: { type: 'boolean', default: false },
  },
});
if (positionals.length !== 1 || (!values.out && !values.site)) {
  console.error('usage: brain-to-dockitty <brain-dir> (--out <docs-dir> | --site <site-dir>) [--scope foundation] [--source-url prefix=url] [--llms frame,commitment] [--clean]');
  process.exit(2);
}
const brainDir = resolve(positionals[0]);
const siteDir = values.site ? resolve(values.site) : null;
const outDir = resolve(values.out ?? join(siteDir, 'docs'));
const scopes = new Set(values.scope?.length ? values.scope : ['foundation']);
// Axes and decisions are the entry points; plays and rules stay reachable from them.
const llmsRoles = new Set((values.llms ?? 'frame,commitment').split(',').map((s) => s.trim()));
const sourceUrls = (values['source-url'] ?? []).map((s) => {
  const i = s.indexOf('=');
  const from = s.slice(0, i);
  return { re: from.startsWith('^') ? new RegExp(from) : null, prefix: from, url: s.slice(i + 1) };
});

// ---------- reading the Brain ----------

function splitFrontmatter(text, file) {
  if (!text.startsWith('---')) throw new Error(`${file}: no frontmatter`);
  const end = text.indexOf('\n---', 3);
  if (end < 0) throw new Error(`${file}: unterminated frontmatter`);
  return { fm: YAML.parse(text.slice(3, end)) ?? {}, body: text.slice(end + 4).replace(/^\r?\n/, '') };
}

const descriptor = JSON.parse(readFileSync(join(brainDir, '.brainkitty', 'brain.json'), 'utf8'));
if (!SUPPORTED_SCHEMA.includes(descriptor.schemaVersion)) {
  console.error(`unsupported Brain schemaVersion ${descriptor.schemaVersion} (supported: ${SUPPORTED_SCHEMA.join(', ')})`);
  process.exit(3);
}

const charter = splitFrontmatter(readFileSync(join(brainDir, 'charters', 'charter.md'), 'utf8'), 'charter.md');
const roleLabel = { frame: 'frame', move: 'move', selector: 'selector', commitment: 'commitment', ...(charter.fm.labels?.roles ?? {}) };
// English plurals for the charter's role labels (axis -> axes, policy -> policies, play -> plays).
function plural(w) {
  if (/is$/i.test(w)) return w.replace(/is$/i, 'es');
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return w.replace(/y$/i, 'ies');
  return `${w}s`;
}
const pluralLabel = Object.fromEntries(ROLES.map((r) => [r, plural(roleLabel[r])]));
const sectionOf = (role) => pluralLabel[role].toLowerCase().replace(/[^a-z0-9]+/g, '-');
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const readDir = (dir) => (existsSync(join(brainDir, dir)) ? readdirSync(join(brainDir, dir)).filter((f) => f.endsWith('.md')) : []);
const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');
/** A wikilink field (`[[id]]` or a bare id) as a bare id. */
const bare = (ref) => String(ref ?? '').trim().replace(/^\[\[\s*|\s*\]\]$/g, '');

const scopeDocs = readDir('scopes').map((f) => splitFrontmatter(readFileSync(join(brainDir, 'scopes', f), 'utf8'), f).fm);
for (const s of scopes) if (!scopeDocs.some((d) => d.id === s)) throw new Error(`no scope ${s} in this Brain`);
const scopeById = new Map(scopeDocs.map((d) => [d.id, d]));
const scopeName = (id) => scopeById.get(id)?.display_name ?? id;
/** A scope's ancestor chain, nearest first, ending at foundation. */
function ancestors(scopeId) {
  const out = [];
  let s = scopeById.get(scopeId)?.parent_scope_id ?? null;
  while (s && !out.includes(s)) {
    out.push(s);
    s = scopeById.get(s)?.parent_scope_id ?? null;
  }
  return out;
}

// Override entities (overrides/): a scope-specific divergence from a base node, with a required reason.
const overrideEntities = readDir('overrides').map((f) => {
  const { fm, body } = splitFrontmatter(readFileSync(join(brainDir, 'overrides', f), 'utf8'), f);
  return { id: fm.id, title: fm.title, target: bare(fm.target_node), scope: fm.scope_id, reason: bare(fm.reason_ref), body: body.trim() };
});

// Extract id -> locator, scanned line by line so a large bulk source is never parsed whole.
// A bulk-file extract resolves to its file; any other locator (web, pdf, mcp ...) to its source's identifier.
const extractLoc = new Map();
for (const f of readDir('sources')) {
  const text = readFileSync(join(brainDir, 'sources', f), 'utf8');
  const srcId = basename(f, '.md');
  let identifier = null;
  let cur = null;
  let fences = 0;
  for (const line of text.split('\n')) {
    if (line === '---' && ++fences === 2) break; // end of frontmatter
    let m = /^identifier: (.+)$/.exec(line);
    if (m) { identifier = unquote(m[1]); continue; }
    if ((m = /^ {2}- id: (\S+)/.exec(line))) {
      cur = { source: srcId, kind: null, path: null, chunk: null, identifier: () => identifier };
      extractLoc.set(unquote(m[1]), cur);
      continue;
    }
    if (!cur) continue;
    if ((m = /^ {6}kind: (\S+)/.exec(line))) cur.kind = unquote(m[1]);
    else if ((m = /^ {6}relativePath: (.+)$/.exec(line))) cur.path = unquote(m[1]);
    else if ((m = /^ {6}chunkIdx: (\d+)/.exec(line))) cur.chunk = Number(m[1]);
  }
}
const extractPath = (loc) => loc.path ?? (loc.kind !== 'bulk-file' ? loc.identifier() : null);

const nodes = new Map();
let skipped = { lifecycle: 0, scope: 0 };
for (const f of readdirSync(join(brainDir, 'nodes')).filter((x) => x.endsWith('.md'))) {
  const { fm, body } = splitFrontmatter(readFileSync(join(brainDir, 'nodes', f), 'utf8'), f);
  if (fm.lifecycle_state !== 'ratified') { skipped.lifecycle++; continue; } // as publishing: ratified only
  if (!scopes.has(fm.scope_id ?? 'foundation')) { skipped.scope++; continue; }
  if (!ROLES.includes(fm.role)) throw new Error(`${f}: unknown role ${fm.role}`);
  nodes.set(fm.id, { fm, body });
}

// ---------- writing the tree ----------

const yamlStr = (v) => JSON.stringify(String(v));
const instant = (s) => (s ? new Date(s).toISOString().replace(/\.\d{3}Z$/, 'Z') : null);
const now = instant(new Date().toISOString());
const pageId = (id) => `${sectionOf(nodes.get(id).fm.role)}/${id}`;

function plain(md) {
  return md.replace(/```[\s\S]*?```/g, ' ').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>#|]/g, '').replace(/\s+/g, ' ').trim();
}
function describe(fm, body) {
  const text = plain(body);
  let d = (text.match(/^(.{40,}?[.!?])(\s|$)/)?.[1] ?? text).trim();
  if (d.length > 180) d = `${d.slice(0, 177).replace(/\s+\S*$/, '')}...`;
  if (d.length < 50) d = `${titleCase(roleLabel[fm.role])}: ${fm.title}. ${d}`.slice(0, 180);
  return d;
}
/** The first matching --source-url rule's URL for a source path, or null. A path that is already a URL is kept. */
function sourceUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  for (const r of sourceUrls) {
    if (r.re) {
      const m = r.re.exec(path);
      if (m) return r.url.replace(/\$(\d)/g, (_, g) => m[Number(g)] ?? '');
    } else if (path.startsWith(r.prefix)) return r.url + path.slice(r.prefix.length);
  }
  return null;
}

// Incoming edges, so a frame page can list what applies under it.
const incoming = new Map();
for (const [id, { fm }] of nodes) {
  for (const e of fm.edges ?? []) {
    if (!nodes.has(e.to)) continue;
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push({ from: id, type: e.type });
  }
}

if (values.clean && existsSync(outDir)) rmSync(outDir, { recursive: true });
mkdirSync(join(outDir, '_meta'), { recursive: true });
mkdirSync(join(outDir, 'context'), { recursive: true });
for (const r of ROLES) mkdirSync(join(outDir, sectionOf(r)), { recursive: true });

const stats = {
  pages: 0, related: 0, droppedEdges: 0, sources: 0, unresolvedSources: 0, renderedReferences: 0, unlinkedSources: 0, bodyLinks: 0,
  overrides: 0, misdeclaredOverrides: 0, skippedOverrides: 0,
};

const link = (id) => (nodes.has(id) ? `[${nodes.get(id).fm.title ?? id}](../${pageId(id)}.md)` : `\`${id}\``);
const reasonText = (r) => (r ? ` Reason: ${link(r)}.` : '');
const callout = (kind, lines) => [`> [!${kind}]`, ...lines.map((l) => (l ? `> ${l}` : '>'))].join('\n');

// Overrides, rendered only when both sides are exported. An `overrides` edge counts when its target sits
// strictly above the declaring node on that node's scope chain (Brain Kitty's precedence contract);
// anything else is misdeclared and stays a plain related link.
const overridesOut = new Map(); // node id -> [{ target, reason }]
const overriddenBy = new Map(); // node id -> [{ by?, entity?, scope, reason }]
const push = (map, k, v) => (map.has(k) ? map.get(k).push(v) : map.set(k, [v]));
for (const [id, { fm }] of nodes) {
  for (const e of fm.edges ?? []) {
    if (e.type !== 'overrides' || !nodes.has(e.to)) continue;
    const from = fm.scope_id ?? 'foundation';
    if (!ancestors(from).includes(nodes.get(e.to).fm.scope_id ?? 'foundation')) { stats.misdeclaredOverrides++; continue; }
    const reason = bare(e.reason_ref) || null;
    push(overridesOut, id, { target: e.to, reason });
    push(overriddenBy, e.to, { by: id, scope: from, reason });
    stats.overrides++;
  }
}
for (const o of overrideEntities) {
  if (!scopes.has(o.scope) || !nodes.has(o.target)) { stats.skippedOverrides++; continue; }
  push(overriddenBy, o.target, { entity: o, scope: o.scope, reason: o.reason || null });
  stats.overrides++;
}

/** Callouts that go right under a page's title: its scope, and any override it declares or receives. */
function scopeCallouts(id, fm) {
  const blocks = [];
  const scope = fm.scope_id ?? 'foundation';
  if (scope !== 'foundation') {
    blocks.push(callout('NOTE', [`Applies in scope **${scopeName(scope)}**, on top of ${ancestors(scope).map((s) => `**${scopeName(s)}**`).join(' and ')}.`]));
  }
  for (const o of overridesOut.get(id) ?? []) {
    const ground = nodes.get(o.target).fm.scope_id ?? 'foundation';
    blocks.push(callout('IMPORTANT', [`In scope **${scopeName(scope)}**, this ${roleLabel[fm.role]} overrides ${link(o.target)} from **${scopeName(ground)}**.${reasonText(o.reason)}`]));
  }
  for (const o of overriddenBy.get(id) ?? []) {
    if (o.entity) {
      blocks.push(callout('NOTE', [`Overridden in scope **${scopeName(o.scope)}**: **${o.entity.title}**.${reasonText(o.reason)}`,
        ...(o.entity.body ? ['', ...o.entity.body.split('\n')] : [])]));
    } else {
      blocks.push(callout('NOTE', [`Overridden in scope **${scopeName(o.scope)}** by ${link(o.by)}.${reasonText(o.reason)}`]));
    }
  }
  return blocks;
}
const brainBlock = (fm) => [
  'brain:',
  `  id: ${yamlStr(fm.id)}`,
  `  brain_id: ${yamlStr(descriptor.brainId)}`,
  `  role: ${fm.role}`,
  `  role_label: ${yamlStr(roleLabel[fm.role])}`,
  ...(fm.node_type ? [`  node_type: ${yamlStr(fm.node_type)}`] : []),
  `  scope: ${yamlStr(fm.scope_id ?? 'foundation')}`,
];

for (const [id, { fm, body }] of nodes) {
  const section = sectionOf(fm.role);
  const related = [];
  for (const e of fm.edges ?? []) {
    if (nodes.has(e.to) && e.to !== id) { related.push({ ref: pageId(e.to), note: e.type }); stats.related++; }
    else stats.droppedEdges++;
  }
  // One entry per source file. `sources` feeds the content graph and OKF;
  // `external_references` is what the page renders (doc-kitty shows no `sources`).
  const byFile = new Map();
  for (const ref of fm.sources ?? []) {
    // `[[extract:<id>]]` or the span form `[[extract:<id>|"quote"]]`; the id stops at `|`.
    const m = /extract:\s*([^\]\s#|]+)/.exec(String(ref));
    const loc = m && extractLoc.get(m[1]);
    const path = loc && extractPath(loc);
    if (path) {
      if (!byFile.has(path)) byFile.set(path, new Set());
      byFile.get(path).add((loc.chunk ?? 0) + 1);
      stats.sources++;
    } else stats.unresolvedSources++;
  }
  const sources = [];
  const references = [];
  for (const [path, parts] of byFile) {
    const url = sourceUrl(path);
    const partNote = parts.size > 1 || !parts.has(1) ? ` (${parts.size > 1 ? 'parts' : 'part'} ${[...parts].sort((a, b) => a - b).join(', ')})` : '';
    sources.push({ resource: url ?? path, title: `${path}${partNote}` });
    if (url) references.push({ url, title: path, note: `drafted from${partNote}` });
    else stats.unlinkedSources++;
  }
  stats.renderedReferences += references.length;
  const tags = [...new Set([roleLabel[fm.role], fm.node_type, ...(fm.tags ?? [])].filter(Boolean).map(String))].slice(0, 6);
  const discoverable = llmsRoles.has(fm.role);
  const fmLines = [
    '---',
    `title: ${yamlStr(fm.title ?? id)}`,
    `description: ${yamlStr(describe(fm, body))}`,
    `doc_status: ${STATUS[fm.lifecycle_state] ?? 'active'}`,
    `updated: "${instant(fm.ratified_at) ?? now}"`,
    `type: ${titleCase(roleLabel[fm.role])}`,
    `kind: ${ROLE_KIND[fm.role]}`,
    `tags: [${tags.map(yamlStr).join(', ')}]`,
    ...(related.length ? ['related:', ...related.map((r) => `  - ref: ${r.ref}\n    note: ${yamlStr(r.note)}`)] : []),
    ...(sources.length ? ['sources:', ...sources.map((s) => `  - resource: ${yamlStr(s.resource)}\n    title: ${yamlStr(s.title)}`)] : []),
    ...(references.length ? ['external_references:', ...references.map((r) => `  - url: ${yamlStr(r.url)}\n    title: ${yamlStr(r.title)}\n    note: ${yamlStr(r.note)}`)] : []),
    ...(fm.ratifier && fm.ratified_at ? ['verified:', `  - by: ${yamlStr(`human:${fm.ratifier}`)}`, `    at: "${instant(fm.ratified_at)}"`] : []),
    ...(discoverable ? [] : ['agent:', '  discoverable: false']),
    'generated:', `  by: brain-to-dockitty/${VERSION}`, `  at: "${now}"`,
    ...brainBlock(fm),
    '---',
    '',
  ];
  // [[node-id]] links in the body become relative links between pages; anything else stays as written.
  let out = body.replace(/\[\[([^\]|#]+)\]\]/g, (all, target) => {
    const t = target.trim();
    if (!nodes.has(t)) return all;
    stats.bodyLinks++;
    return `[${nodes.get(t).fm.title ?? t}](../${pageId(t)}.md)`;
  });
  if (!/^#\s/m.test(out)) out = `# ${fm.title ?? id}\n\n${out}`;
  const callouts = scopeCallouts(id, fm);
  if (callouts.length) {
    // Directly under the title, so a reader sees the scope and any override before the body.
    out = out.replace(/^(#\s[^\n]*\n)/m, (h1) => `${h1}\n${callouts.join('\n\n')}\n`);
  }
  const under = (incoming.get(id) ?? []).filter((e) => e.type === 'applies-under');
  if (fm.role === 'frame' && under.length) {
    const byRole = {};
    for (const e of under) (byRole[nodes.get(e.from).fm.role] ??= []).push(e.from);
    out += `\n\n## What applies under this ${roleLabel.frame}\n`;
    for (const r of ROLES.filter((x) => byRole[x])) {
      out += `\n### ${titleCase(pluralLabel[r])} (${byRole[r].length})\n\n`;
      out += byRole[r].sort().map((n) => `- [${nodes.get(n).fm.title ?? n}](../${pageId(n)}.md)`).join('\n') + '\n';
    }
  }
  writeFileSync(join(outDir, section, `${id}.md`), fmLines.join('\n') + out.trimEnd() + '\n');
  stats.pages++;
}

// Hubs, charter page, root, section registry.
const counts = Object.fromEntries(ROLES.map((r) => [r, [...nodes.values()].filter((n) => n.fm.role === r).length]));
for (const r of ROLES) {
  const label = titleCase(roleLabel[r]);
  const hub = ['---', `title: ${yamlStr(`${titleCase(pluralLabel[r])}`)}`,
    `description: ${yamlStr(`The ${counts[r]} ratified ${pluralLabel[r]} in the ${descriptor.displayName} Brain, one page each.`)}`,
    'doc_status: active', `updated: "${now}"`, `type: ${label}`, 'kind: Hub', 'okf_version: "0.2"',
    'generated:', `  by: brain-to-dockitty/${VERSION}`, `  at: "${now}"`, '---', '', `# ${titleCase(pluralLabel[r])}`, '',
    `${counts[r]} ratified ${pluralLabel[r]}. Each page lists the ${roleLabel[r]}'s relations and the sources it was drafted from.`];
  writeFileSync(join(outDir, sectionOf(r), 'README.md'), hub.join('\n') + '\n');
}
writeFileSync(join(outDir, 'context', 'README.md'), ['---', 'title: "Context"',
  `description: ${yamlStr(`What the ${descriptor.displayName} Brain is for, and the charter it was curated under.`)}`,
  'doc_status: active', `updated: "${now}"`, 'type: Context', 'kind: Hub', 'okf_version: "0.2"', '---', '', '# Context', ''].join('\n'));
writeFileSync(join(outDir, 'context', 'charter.md'), ['---', 'title: "Charter"',
  `description: ${yamlStr(`The charter of the ${descriptor.displayName} Brain: its purpose, role labels and node types.`)}`,
  'doc_status: active', `updated: "${now}"`, 'type: Context', 'kind: Reference',
  'generated:', `  by: brain-to-dockitty/${VERSION}`, `  at: "${now}"`, '---', '', '# Charter', '',
  charter.fm.description ?? '', '', '## Role labels', '',
  ...ROLES.map((r) => `- **${r}**: ${roleLabel[r]} (${counts[r]} ratified)`), '',
  '## Node types', '',
  ...ROLES.filter((r) => charter.fm.types?.[r]).map((r) => `- **${roleLabel[r]}**: ${charter.fm.types[r].join(', ')}`), '',
  charter.body.trim()].join('\n') + '\n');
writeFileSync(join(outDir, 'README.md'), ['---', `title: ${yamlStr(descriptor.displayName)}`,
  `description: ${yamlStr(`The ratified content of the ${descriptor.displayName} Brain, exported for reading. Answers and checks run on the Brain itself.`)}`,
  'doc_status: active', `updated: "${now}"`, 'kind: Hub', 'okf_version: "0.2"',
  'generated:', `  by: brain-to-dockitty/${VERSION}`, `  at: "${now}"`, '---', '', `# ${descriptor.displayName}`, '',
  plain(charter.fm.description ?? '').slice(0, 600), '',
  ...ROLES.map((r) => `- [${titleCase(pluralLabel[r])}](./${sectionOf(r)}/README.md): ${counts[r]}`),
  '- [Charter](./context/charter.md)'].join('\n') + '\n');
const registry = {
  version: 1,
  sections: {
    entries: [
      { id: 'context', label: 'Context', order: 5, type: 'Context', purpose: 'What this Brain is for' },
      ...ROLES.map((r) => ({ id: sectionOf(r), label: `${titleCase(pluralLabel[r])}`, order: ROLE_ORDER[r], type: titleCase(roleLabel[r]),
        purpose: `Ratified ${pluralLabel[r]}`, ...(llmsRoles.has(r) ? {} : { feeds: ['sitemap', 'rss'] }) })),
    ],
  },
};
writeFileSync(join(outDir, '_meta', 'charter.yaml'), `# Generated by brain-to-dockitty/${VERSION}\n${YAML.stringify(registry)}`);

// ---------- optional site scaffold ----------

const scaffolded = [];
if (siteDir) {
  const title = values.title ?? `${descriptor.displayName} (Brain)`;
  const base = values.base ? `/${values.base.replace(/^\/+|\/+$/g, '')}` : '';
  const sidebar = [
    { label: 'Overview', link: '/' },
    { label: 'Charter', link: '/context/charter/' },
    ...ROLES.slice().sort((a, b) => ROLE_ORDER[a] - ROLE_ORDER[b])
      .map((r) => ({ label: titleCase(pluralLabel[r]), link: `/${sectionOf(r)}/` })),
  ];
  const files = {
    'package.json': `${JSON.stringify({
      name: `${descriptor.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-site`, private: true, type: 'module',
      scripts: { build: 'astro build', preview: 'astro preview' },
      dependencies: { '@astrojs/markdown-remark': '^7.3.3', '@astrojs/sitemap': '^3.7.4', '@spec-kitty/doc-toolkit': values.toolkit, astro: '^7.4.0' },
      devDependencies: { '@astrojs/starlight': '^0.42.6' },
    }, null, 2)}\n`,
    'astro.config.mjs': [
      `// Generated by brain-to-dockitty/${VERSION}. Edit freely; the exporter never overwrites this file.`,
      "import { defineConfig } from 'astro/config';",
      "import { defineDocKittyIntegrations } from '@spec-kitty/doc-toolkit/config';",
      "import { specKittyTheme } from '@spec-kitty/doc-toolkit/themes/spec-kitty/index.ts';",
      '',
      '// A Brain has thousands of pages. The generated sidebar would put every one of them on',
      '// every page (about 1 MB each at 5,000 pages), so the sidebar lists the hubs only; pages',
      '// are reached from the hubs, the frame pages, related links and search.',
      'export default defineConfig({',
      `  site: ${JSON.stringify(values['site-url'])},`,
      ...(base ? [`  base: ${JSON.stringify(base)},`] : []),
      '  integrations: defineDocKittyIntegrations({',
      `    title: ${JSON.stringify(title)},`,
      `    description: ${JSON.stringify(`The ratified content of the ${descriptor.displayName} Brain.`)},`,
      ...(base ? [`    base: ${JSON.stringify(base)},`] : []),
      '    theme: specKittyTheme,',
      "    indexBasename: ['README'],",
      '    // Scope and override callouts use GitHub alert syntax (> [!NOTE]), so they render here and on GitHub.',
      '    githubAlerts: true,',
      `    sidebar: ${JSON.stringify(sidebar)},`,
      '  }),',
      '});',
      '',
    ].join('\n'),
    'tsconfig.json': `${JSON.stringify({ extends: 'astro/tsconfigs/strict', include: ['.astro/types.d.ts', '**/*'], exclude: ['dist'] }, null, 2)}\n`,
    'src/content.config.ts': [
      "import { defineCollection } from 'astro:content';",
      "import { docKittyDocsSchema, docKittyDocsLoader } from '@spec-kitty/doc-toolkit/schema';",
      '',
      "export const collections = { docs: defineCollection({ loader: docKittyDocsLoader({ base: 'docs' }), schema: docKittyDocsSchema() }) };",
      '',
    ].join('\n'),
    'src/pages/llms.txt.ts': `import { llmsTxtRoute } from '@spec-kitty/doc-toolkit/routes';\nexport const GET = llmsTxtRoute({ title: ${JSON.stringify(title)}, description: ${JSON.stringify(`Axes and decisions of the ${descriptor.displayName} Brain; plays and rules are linked from them.`)} });\n`,
    'src/pages/rss.xml.ts': `import { rssRoute } from '@spec-kitty/doc-toolkit/routes';\nexport const GET = rssRoute({ title: ${JSON.stringify(title)}, description: 'Newly ratified nodes.' });\n`,
    'src/pages/api/index.json.ts': `import { agentIndexRoute } from '@spec-kitty/doc-toolkit/routes';\nexport const GET = agentIndexRoute({ title: ${JSON.stringify(title)} });\n`,
    'src/pages/api/pages/[...slug].json.ts': "import { agentPageRoute } from '@spec-kitty/doc-toolkit/routes';\nconst route = agentPageRoute();\nexport const getStaticPaths = route.getStaticPaths;\nexport const GET = route.GET;\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const p = join(siteDir, rel);
    if (existsSync(p)) continue;
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
    scaffolded.push(rel);
  }
}

console.log(JSON.stringify({ brain: descriptor.displayName, schemaVersion: descriptor.schemaVersion, scopes: [...scopes], skipped,
  counts, extractsIndexed: extractLoc.size, llmsRoles: [...llmsRoles], ...stats, ...(siteDir ? { site: siteDir, scaffolded } : {}) }, null, 1));
