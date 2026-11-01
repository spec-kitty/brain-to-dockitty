# brain-to-dockitty

Export a Brain Kitty Brain's ratified content as a
[DocKitty](https://github.com/spec-kitty/doc-kitty) `docs/` tree, and build it into a static site with `llms.txt`,
an agent API, a content graph and an OKF bundle.

A Brain's markdown is its source of truth (the SQLite index is derived), and DocKitty renders whatever `docs/` tree
it is given. This tool sits between the two and depends on neither. The site is the read-only, browsable half of a
Brain; answers, checks and capabilities still run on the Brain itself.

Exactly what the exporter reads from a Brain, and what it ignores, is in
[docs/brain-format.md](./docs/brain-format.md): the versioned read contract for Brain format schemaVersion 1.

## Quickstart

The exporter isn't published to a package registry yet, so run it straight from this repository:

```sh
pnpm dlx github:spec-kitty/brain-to-dockitty ~/BrainKittyWorkspace/my-brain --site ./my-brain-site \
  --source-url 'my-repo/=https://github.com/my-org/my-repo/blob/main/'
cd my-brain-site
pnpm install
pnpm build
```

`npx github:spec-kitty/brain-to-dockitty …` works the same way. Both fetch the latest `main`; add `#<commit>` to the
spec (for example `github:spec-kitty/brain-to-dockitty#9f62937`) to pin a version. To run from a clone instead:

```sh
git clone https://github.com/spec-kitty/brain-to-dockitty.git
cd brain-to-dockitty && pnpm install
node bin/brain-to-dockitty.mjs ~/BrainKittyWorkspace/my-brain --site ../my-brain-site
```

The generated site depends on `@spec-kitty/doc-toolkit`, which comes from the GitHub Packages registry. See doc-kitty's
[consumer setup](https://github.com/spec-kitty/doc-kitty/blob/main/docs/guides/consumer-setup.md) for the
`.npmrc` it needs.

To write only the docs tree into an existing doc-kitty site, use `--out <docs-dir>` instead of `--site`.

## GitHub Action

Keep a Brain in a repository and publish it on every push. This workflow exports it, builds the site and deploys it
to GitHub Pages:

```yaml
name: Publish the Brain
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: read
  pages: write
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v5
      - id: brain
        uses: spec-kitty/brain-to-dockitty@main   # pin a commit SHA in production
        with:
          brain-dir: my-brain
          scopes: foundation
          source-urls: |
            my-repo/=https://github.com/my-org/my-repo/blob/main/
          site-url: https://my-org.github.io
          base: /my-repo
          build: true
          packages-token: ${{ secrets.DOC_TOOLKIT_TOKEN }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${{ steps.brain.outputs.dist-dir }}
      - uses: actions/deploy-pages@v4
```

`@spec-kitty/doc-toolkit` comes from GitHub Packages, so `build: true` needs a token with `read:packages`. Use a
repository secret, as above. The workflow's `GITHUB_TOKEN` works only if the package grants your repository read
access. The action writes the token to the runner's user-level `.npmrc` and never into the site.

| Input | Default | What it does |
|---|---|---|
| `brain-dir` | (required) | The Brain folder in your repository. |
| `site-dir` | `brain-site` | Where the site is written; the docs tree goes to `<site-dir>/docs`. |
| `scopes` | `foundation` | Scopes to export, separated by commas or newlines. |
| `source-urls` | | One `--source-url` rule per line. |
| `llms` | `frame,commitment` | Roles listed in `llms.txt` and the agent API. |
| `title`, `site-url`, `base`, `toolkit` | | Passed to the scaffold. |
| `build` | `false` | Install the site's dependencies and build it. |
| `packages-token` | | `read:packages` token, needed with `build: true`. |
| `node-version` | `22` | Node.js version. |

Outputs: `docs-dir`, `site-dir` and `dist-dir` (the built site).

## Options

| Option | Default | What it does |
|---|---|---|
| `--out <dir>` | | Write the docs tree here. |
| `--site <dir>` | | Write the tree to `<dir>/docs` and scaffold a site around it: `astro.config.mjs` with a hubs-only sidebar, the content config, and the `llms.txt`, RSS and agent-API routes. Existing files are never overwritten. |
| `--scope <id>` | `foundation` | Scopes to export; repeat for more. With more than one, scoped pages and overrides get callouts (see below). |
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
| A node in a narrower scope | A callout under its title: the scope it applies in, on top of which broader scopes |
| An `overrides` edge up the scope chain | Callouts on both pages: what it overrides and why, and which scope overrides the ground node |
| An override entity (`overrides/`) | A callout on the target page with the override's title, reason and body |

Callouts use GitHub alert syntax (`> [!NOTE]`), so they render on GitHub and, with the scaffold's
`githubAlerts: true`, as asides on the site. An `overrides` edge that does not point up the declaring node's scope
chain is misdeclared under Brain Kitty's precedence contract: it gets no callout and stays a related link.

## Known limits

These are tracked upstream in doc-kitty:

- Role types are valid but warn on every page, because a charter can't add types yet (spec-kitty/doc-kitty#278).
- Pages don't show `sources` or `verified`; the exporter writes `external_references` so sources are visible
  (spec-kitty/doc-kitty#279).
- The `brain:` block and related-link notes don't reach the agent API or OKF (spec-kitty/doc-kitty#280).
- `llms.txt` and `api/index.json` outgrow one read at a few thousand pages, and the generated sidebar puts every page
  on every page; the scaffold uses a hubs-only sidebar (spec-kitty/doc-kitty#281).

Not yet supported: one site per standpoint (a multi-scope export shows every exported scope side by side, with
callouts), and span-level citation quotes.

The exporter reads the Brain's markdown directly, so it skips the integrity checks the Brain Kitty app runs when it
opens a Brain. Export a Brain the app has saved, not one being edited by hand.

## Development

```sh
pnpm install
pnpm test
```

The tests run the CLI against a small synthetic Brain in `test/fixtures/brain`, with two scopes, overrides, a web
source and a span reference. They also include a licensing gate.

CI also runs the action on the fixture. It then checks doc-kitty out at a pinned commit, and runs doc-kitty's
frontmatter gate and a full site build against its workspace toolkit. That needs no GitHub Packages token, because
doc-kitty is public.

## License

MIT, copyright Spec Kitty, Inc. See [LICENSE](./LICENSE). The repository follows the Spec Kitty Repo Licensing
Policy: canonical MIT text, the entity as the only copyright holder, and package metadata that names the same entity.
No third-party code is bundled, so there is no NOTICE file.
