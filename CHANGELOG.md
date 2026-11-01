# Changelog

## Unreleased

## 0.2.0 (2026-11-01)

- **Overrides.** When several scopes are exported, scoped pages name their scope. `overrides` edges that point up the
  scope chain, and override entities from `overrides/`, render as callouts on both pages. Misdeclared overrides are
  counted, not rendered.
- **Sources.** Span references (`[[extract:<id>|"quote"]]`) resolve. Extracts with non-file locators (web, PDF,
  MCP) resolve to their source's identifier, and a source that is already a URL is linked directly.
- **GitHub Action.** `action.yml` exports a Brain and, with `build: true`, builds the site with a `read:packages`
  token.
- **Site scaffold.** It now writes `tsconfig.json`, adds `@astrojs/markdown-remark`, and turns on `githubAlerts`.
- **Docs.** `docs/brain-format.md` is the versioned read contract for Brain format schemaVersion 1. The README no
  longer links to Brain Kitty's private repository.
- **CI.** It runs the action, doc-kitty's frontmatter gate and a full site build against doc-kitty at a pinned
  commit, without a token.

- README: the quickstart runs the exporter straight from GitHub (`pnpm dlx github:spec-kitty/brain-to-dockitty`), since
  no package is published yet.

## 0.1.0 (2026-11-01)

- First version: exports a Brain's ratified nodes (foundation scope by default) as a DocKitty `docs/` tree with one
  section per charter role label, typed edges as `related` notes, ratification as `verified`, and source files as
  both `sources` and rendered `external_references`.
- `--site` scaffolds a buildable doc-kitty site with a hubs-only sidebar.
- `--llms` chooses which roles appear in `llms.txt` and the agent API (default: frames and commitments).
- `--source-url` maps source paths to links by prefix, or by regex when the rule starts with `^`.
- Licensing gate: CI fails if `LICENSE` or the package metadata drift from the Repo Licensing Policy.
