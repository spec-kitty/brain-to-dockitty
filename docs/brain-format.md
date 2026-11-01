# Brain format, schemaVersion 1, as read by brain-to-dockitty

This is the **read contract** of brain-to-dockitty 0.2: the files and fields of a Brain the exporter reads, what it
does with them, and what it ignores. Brain Kitty owns the Brain format and its canonical definition. This page is
the consumer-side contract, so a change in Brain Kitty that breaks it is visible, and a new `schemaVersion` is
refused rather than misread.

## Version check

`.brainkitty/brain.json` is a JSON object:

| Field | Type | Use |
|---|---|---|
| `schemaVersion` | integer | Must be `1`. Any other value: the exporter prints `unsupported Brain schemaVersion <n>` and exits with code 3, before writing anything. |
| `brainId` | string | Written to each page's `brain.brain_id`. |
| `displayName` | string | Site title, root page and hub descriptions. |
| `createdAt` | ISO string | Not used. |
| `example` | boolean, optional | Not used. |

## Layout

A Brain is a folder. Every entity is a markdown file with YAML frontmatter between `---` fences; the body is the
markdown after the closing fence. The first folder under the Brain decides the entity kind:

| Folder | Entity | Read |
|---|---|---|
| `nodes/` | node | yes |
| `scopes/` | scope | yes |
| `overrides/` | override | yes, when present |
| `sources/` | source and its extracts | yes |
| `charters/charter.md` | charter | yes |
| `layers/` | layer | no |
| `.brainkitty/` | descriptor, derived index, settings, caches | only `brain.json` |
| `runs/` and anything else | run journals, working files | no |

The SQLite index (`.brainkitty/index.sqlite`) is derived from the markdown and is never opened. Unknown
frontmatter keys are ignored.

## Charter (`charters/charter.md`)

| Field | Use |
|---|---|
| `description` | Root page text and the charter page. |
| `labels.roles.{frame,move,selector,commitment}` | Section names, page `type`, hub titles. A missing label falls back to the canonical role name. |
| `types.<role>` | Listed on the charter page. |
| body | Appended to the charter page. |

`id` and `revision` are not used.

## Scopes (`scopes/<id>.md`)

| Field | Use |
|---|---|
| `id` | Matched against `--scope`. An unknown scope is an error. |
| `display_name` | Scope callouts ("Applies in scope **Team A** ..."). |
| `parent_scope_id` | Builds each scope's ancestor chain up to `foundation` (`null` at the root). |

`layer` is not used.

## Nodes (`nodes/<id>.md`)

| Field | Use |
|---|---|
| `id` | Page file name and route (`<section>/<id>.md`). |
| `title` | Page title. |
| `role` | `frame`, `move`, `selector` or `commitment`; picks the section. Any other value is an error. |
| `scope_id` | Defaults to `foundation`. Only nodes in an exported scope are written. |
| `lifecycle_state` | Only `ratified` nodes are exported. `draft`, `dated` and `retired` are skipped, as in Brain Kitty publishing. |
| `ratifier`, `ratified_at` | `verified: [{by: human:<ratifier>, at}]` and `updated`. |
| `node_type` | A tag and `brain.node_type`. |
| `tags` | Page tags (up to six, after the role label and node type). |
| `edges[]` | `{to, type, reason_ref?}`. Each edge to an exported node becomes `related: [{ref, note: <type>}]`; edges to missing nodes are dropped. `overrides` edges also produce callouts (see Overrides). |
| `sources[]` | Extract references (see Sources). |
| body | Page body. `[[node-id]]` links to an exported node become relative links; other `[[...]]` text is left as written. |

`relations` is not used.

Edge types are `cites`, `composes-with`, `alternative-to`, `supersedes`, `refines`, `overrides`, `applies-under`
and `selects`. Frame pages also list the nodes with an `applies-under` edge to them.

## Sources and extracts (`sources/<id>.md`)

A node cites an extract as `[[extract:<extract-id>]]`, or as a span, `[[extract:<extract-id>|"literal words"]]`
(optionally with `~"prefix"~"suffix"` disambiguators). The exporter takes the id up to the `|` and does not use the
quote.

From a source file it reads:

| Field | Use |
|---|---|
| `identifier` | Where a non-file extract points (for a web source, its URL). |
| `extracts[].id` | Matched against node references. |
| `extracts[].locator.kind` | `bulk-file` resolves to `relativePath`; any other kind (`pdf-page`, `pdf-char`, `docx-path`, `web-dom`, `web-fragment`, `mcp-record`, `opaque`) resolves to the source's `identifier`. |
| `extracts[].locator.relativePath`, `chunkIdx` | File path and part number ("drafted from (parts 1, 3)"). |

Extract `text` and every other source field are not read. Source files are scanned line by line, because a bulk
source can hold tens of thousands of extracts. The scan relies on the Brain Kitty serializer's layout: top-level keys
at column 0, extracts as `  - id:` items with locator fields indented six spaces.

A reference that does not resolve (an unknown id, or a malformed reference) is counted as `unresolvedSources` and
left out. A resolved path becomes a link when it is already an `http(s)` URL or matches a `--source-url` rule.

## Overrides

Brain Kitty records scope-specific divergence in two ways. The exporter renders both, as callouts directly under the
page title, only when both sides are exported:

- **An `overrides` edge** on a node. It counts only when its target's scope sits strictly above the declaring node's
  scope on that node's chain, which is Brain Kitty's precedence contract. `reason_ref` is optional. The overriding
  page says what it overrides and why; the overridden page says which scope overrides it and with which node. An edge
  that breaks the contract (same scope, or the wrong direction) is counted as `misdeclaredOverrides`, gets no
  callout, and stays a plain related link.
- **An override entity** in `overrides/<id>.md`: `id`, `title`, `target_node` (a `[[node-id]]` wikilink), `scope_id`
  (a non-foundation scope) and `reason_ref` (required), plus a body that replaces the target's body in that scope.
  The target page shows the override's title, reason and body. An override whose scope is not exported is counted
  as `skippedOverrides`.

A node in a non-foundation scope also gets a callout naming its scope and the scopes it applies on top of.

## Compatibility

The exporter reads Brains that Brain Kitty itself wrote at schemaVersion 1. Hand-edited files that Brain Kitty's
parser would still accept can fall outside the line-scan layout above. When Brain Kitty moves to a new
`schemaVersion`, this page and the exporter's supported list change together.
