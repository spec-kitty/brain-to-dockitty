---
id: cut-on-tuesday
title: Cut releases on Tuesdays
role: move
scope_id: foundation
lifecycle_state: ratified
ratifier: alice
ratified_at: '2026-10-04T10:00:00.000Z'
edges:
  - to: release-process
    type: applies-under
  - to: two-approvals
    type: composes-with
sources:
  - '[[extract:ext-src-bulk-fixture-aaaa|"every second Tuesday"]]'
---
Cut the release branch from main every second Tuesday.
