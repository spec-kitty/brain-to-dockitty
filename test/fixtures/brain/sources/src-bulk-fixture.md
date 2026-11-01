---
id: src-bulk-fixture
title: Bulk ingest · fixture
source_kind: bulk-ingest
identifier_type: directory
identifier: /tmp/fixture-sources
extracts:
  - id: ext-src-bulk-fixture-aaaa
    locator:
      kind: bulk-file
      relativePath: repo/docs/release.md
      chunkIdx: 0
    text: |-
      Releases are cut from main every second Tuesday.
  - id: ext-src-bulk-fixture-bbbb
    locator:
      kind: bulk-file
      relativePath: repo/docs/release.md
      chunkIdx: 2
    text: |-
      A release needs two approvals.
  - id: ext-src-bulk-fixture-cccc
    locator:
      kind: bulk-file
      relativePath: issues/repo/42-freeze-window.md
      chunkIdx: 0
    text: |-
      Freeze window discussion.
---
