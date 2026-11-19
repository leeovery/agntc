TASK: configless-install-3-6 — Verify+adjust pipeline selection over the structural member set (detected.plugins): prompt select-all installs every member; tree-path selector installs a single member without prompting; direct-path membership check against structural list; non-member selector errors clearly. Each member keyed owner/repo/<unit>. Config-bearing flow unchanged.

ACCEPTANCE CRITERIA: select-all installs every structural member keyed owner/repo/<unit> (configless incl.); tree-path selector installs single member without prompting; selector subpath not in structural list → clear error naming target + available members, no install; selection operates over detected.plugins; config-bearing flow unchanged; install-every is select-all not --plugin.

STATUS: Complete

SPEC CONTEXT: Collection Membership & Selection Flow (structural membership via detected.plugins; flag-free prompt + tree-path selector; install every = select-all not --plugin); Source selector grammar; Manifest Keying (owner/repo/<unit-dir>); Error & Abort (partial outcomes). Verification task layered on Phase 2 task 2-3 reroute.

IMPLEMENTATION: Implemented. src/commands/add.ts.
- Select-all/prompt: 493-504 non-direct-path branch calls selectCollectionPlugins({plugins: detected.plugins, ...}); per-member loop (541-688, 692-722) installs each.
- Direct-path selector: 486-492 if(!detected.plugins.includes(parsed.targetPlugin)) throw Error; membership vs structural list; on match selectedPlugins=[targetPlugin], no prompt.
- Keying: memberKey helper (87-94) direct-path ? parsed.manifestKey : `${parsed.manifestKey}/${pluginName}`; used at 5a conflict (616) + write loop (733) — single source, can't diverge.
- Error message (487-491): names ghost + lists detected.plugins; propagates to outer catch → cancel + ExitSignal(1) before any write.
- No --plugin install-all introduced (--plugin at 769 = "Bundle a skills-only source", forwards forcePlugin only). Coexistence w/ 2-3: subpath re-detecting standalone → standalone tail keyed owner/repo/<subpath> (test 6061); pipeline direct-path branch only when subpath re-detects collection. Config-bearing flow untouched (config read only for agents).

TESTS: Adequate. tests/commands/add.test.ts: select-all installs every structural member keyed (2855); configless-incl (2565,2620,2646,2734); tree-path selector single member no prompt selectCollectionPlugins NOT called (2834); non-member selector clear error names ghost + lists members + no copy/write/addEntry (2812); selection over structural list (2674); config-bearing flow unchanged (844 suite: 911,991,1017,1005); coexistence 2-3 (6061, 1427). Behaviour-focused, not over-tested.

CODE QUALITY: Conventions followed (discriminated-union narrowing; memberKey/buildAddEntry dedupe per DRY w/ doc comments). SOLID good (runCollectionPipeline single responsibility; selection localized 486-504). Complexity acceptable (long pipeline but linear stages). Modern idioms. Readability good.

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [idea] src/commands/add.ts:487-491 — direct-path non-member case throws a plain Error routed through the generic outer catch, while sibling pre-flight failures (not-agntc 309, type conflict 286) emit an identity-prefixed p.cancel + ExitSignal(1) directly. Behaviour equivalent (exit 1, message names target+members, tested at 2812); consider aligning to the identity-prefixed cancel pattern for message consistency. Stylistic, not a fix.
