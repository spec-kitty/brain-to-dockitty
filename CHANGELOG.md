# Changelog

## Unreleased

## 0.1.0 (2026-11-01)

- First version: exports a Brain's ratified nodes (foundation scope by default) as a DocKitty `docs/` tree with one
  section per charter role label, typed edges as `related` notes, ratification as `verified`, and source files as
  both `sources` and rendered `external_references`.
- `--site` scaffolds a buildable doc-kitty site with a hubs-only sidebar.
- `--llms` chooses which roles appear in `llms.txt` and the agent API (default: frames and commitments).
- `--source-url` maps source paths to links by prefix, or by regex when the rule starts with `^`.
- Licensing gate: CI fails if `LICENSE` or the package metadata drift from the Repo Licensing Policy.
