---
id: two-approvals
title: A release needs two approvals
role: commitment
scope_id: foundation
lifecycle_state: ratified
ratifier: bob
ratified_at: '2026-10-03T10:00:00.000Z'
node_type: policy
edges:
  - to: release-process
    type: applies-under
  - to: does-not-exist
    type: refines
sources:
  - '[[extract:ext-src-bulk-fixture-aaaa]]'
  - '[[extract:ext-src-bulk-fixture-bbbb]]'
  - '[[extract:ext-src-bulk-fixture-cccc]]'
  - '[[extract:ext-unknown]]'
---
Every release needs two approvals before it is cut. See [[cut-on-tuesday]] for timing.
