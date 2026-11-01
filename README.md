# brain-to-dockitty

Export a [Brain Kitty](https://github.com/spec-kitty/brain-kitty) Brain's ratified content as a
[DocKitty](https://github.com/spec-kitty/doc-kitty) `docs/` tree, and build it into a static site with `llms.txt`,
an agent API, a content graph and an OKF bundle.

A Brain's markdown is its source of truth (the SQLite index is derived), and DocKitty renders whatever `docs/` tree
it is given. This tool sits between the two and depends on neither. The site is the read-only, browsable half of a
Brain; answers, checks and capabilities still run on the Brain itself.

## Quickstart

```sh
pnpm dlx @spec-kitty/brain-to-dockitty ~/BrainKittyWorkspace/my-brain --site ./my-brain-site \
  --source-url 'my-repo/=https://github.com/my-org/my-repo/blob/main/'
cd my-brain-site
pnpm install
pnpm build
```

`@spec-kitty/doc-toolkit` comes from the GitHub Packages registry. See doc-kitty's
[consumer setup](https://github.com/spec-kitty/doc-kitty/blob/main/docs/guides/consumer-setup.md) for the
`.npmrc` it needs.

To write only the docs tree into an existing doc-kitty site, use `--out <docs-dir>` instead of `--site`.

## Options

| Option | Default | What it does |
|---|---|---|
| `--out <dir>` | | Write the docs tree here. |
| `--site <dir>` | | Write the tree to `<dir>/docs` and scaffold a site around it: `astro.config.mjs` with a hubs-only sidebar, the content config, and the `llms.txt`, RSS and agent-API routes. Existing files are never overwritten. |
| `--scope <id>` | `foundation` | Scopes to export; repeat for more. |
| `--llms <roles>` | `frame,commitment` | Roles listed in `llms.txt` and the agent API. Other pages get `agent.discoverable: false` and stay reachable from hubs and links. |
| `--source-url <rule>` | | `prefix=url-prefix` maps source paths to links. A rule starting with `^` is a regex, and `$1` and onwards in the URL are its groups. Repeatable; the first match wins. |
| `--title`, `--site-url`, `--base` | | Site title, canonical URL and base path for the scaffold. |
| `--toolkit <spec>` | `^0.5.0` | `@spec-kitty/doc-toolkit` version written into a scaffolded `package.json`. |
| `--clean` | | Delete the output folder first. |

The exit code is 2 for bad usage, and 3 when the Brain's `schemaVersion` is one this version does not know.

## How a Brain maps onto DocKitty

| Brain | DocKitty |
|---|---|
| Ratified node (`nodes/<id>.md`) | One page, `<section>/<id>.md`. Drafts, dated and retired nodes are not exported. |
| Role: frame, move, selector, commitment | One section per role, named by the charter's role labels (`axis` becomes Axes). The type is the role label; the kind is Explanation, How-To or Reference. |
| Edges | `related: [{ref, note: <edge type>}]`. Edges to missing nodes are dropped. |
| `ratifier`, `ratified_at` | `verified: [{by: human:<ratifier>, at}]` and `updated` |
| Source extracts | `sources` (content graph, OKF) plus inline `external_references`, which render on the page |
| Frames | A generated "What applies under this ..." list on each frame page |
| Role, node type, Brain id, scope | A `brain:` frontmatter block |
| Charter | `context/charter.md` |

## Known limits

These are tracked upstream in doc-kitty:

- Role types are valid but warn on every page, because a charter can't add types yet (spec-kitty/doc-kitty#278).
- Pages don't show `sources` or `verified`; the exporter writes `external_references` so sources are visible
  (spec-kitty/doc-kitty#279).
- The `brain:` block and related-link notes don't reach the agent API or OKF (spec-kitty/doc-kitty#280).
- `llms.txt` and `api/index.json` outgrow one read at a few thousand pages, and the generated sidebar puts every page
  on every page; the scaffold uses a hubs-only sidebar (spec-kitty/doc-kitty#281).

Not yet supported: scope precedence and override rendering beyond listing a scope's own nodes, and span-level
citation quotes.

The exporter reads the Brain's markdown directly, so it skips the integrity checks the Brain Kitty app runs when it
opens a Brain. Export a Brain the app has saved, not one being edited by hand.

## Development

```sh
pnpm install
pnpm test
```

The tests run the CLI against a small synthetic Brain in `test/fixtures/brain`. They also include a licensing gate.

## License

MIT, copyright Spec Kitty, Inc. See [LICENSE](./LICENSE). The repository follows the Spec Kitty Repo Licensing
Policy: canonical MIT text, the entity as the only copyright holder, and package metadata that names the same entity.
No third-party code is bundled, so there is no NOTICE file.
