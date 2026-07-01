# `update` fails for a skill installed from a branch ref

A skill installed cleanly with `add` cannot be update-checked and reports a hard error on both `update` and `list`.

Concretely: `nuxt/ui/skills/nuxt-ui` was installed with `agntc add`. The install succeeded — the skill landed locally and the manifest entry was written. But `agntc update` (and the update-status column in `agntc list`) reports:

```
nuxt/ui/skills/nuxt-ui: Check failed — Tag 'v4' not found on remote
```

The condition that triggers it: this source was pinned to `ref: "v4"`, and on the `nuxt/ui` remote `v4` is a **branch** (`refs/heads/v4`), not a tag. The repo's tags are `v4.9.0`, `v4.8.2`, `v4.7.1`, and so on — there is no tag literally named `v4`. The manifest entry recorded `ref: "v4"` with `commit: 08bdab4…` (the tip of that branch) and, unlike the other working entry (`leeovery/agentic-skills/nuxt`, pinned to the real tag `v0.1.4` with a `constraint`), it carries no `constraint` field.

So `add` and `update` disagree about what a `ref` is. Install resolved `v4` against the remote, found the branch, and recorded its tip — no complaint. The update path instead treats the stored `ref` as a semver tag and does a tag-existence lookup against the remote; with no `v4` tag to match, it throws `Tag 'v4' not found on remote` and the entry can never resolve to an up-to-date / update-available status.

Impact: any source pinned to a branch rather than a semver tag is effectively stranded — it installs fine but is permanently un-updatable, and it surfaces as a loud "Check failed" every time `list` or `update` runs. This is the exact case where an upstream distributes a skill from a long-lived version branch (nuxt/ui ships it from `skills/nuxt-ui/` on the `v4` branch) rather than tagging it.

Relevant areas that came up: `src/update-check.ts` (manifest-vs-remote comparison), `src/version-resolve.ts` (`resolveVersion` / `resolveLatestVersion`, semver tag resolution), `src/git-utils.ts` (ls-remote / ref resolution), and the `ManifestEntry` shape in `src/manifest.ts` (`ref`, `commit`, optional `constraint`).
