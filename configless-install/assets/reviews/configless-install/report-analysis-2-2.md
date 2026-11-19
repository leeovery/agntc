TASK: configless-install-analysis-2-2 — Narrow PluginInstallResult.detectedType to Extract<DetectedType,{type:"bare-skill"|"plugin"}> (required on installed variant), delete the runtime narrowing throw, key manifestTypeFromDetected on the discriminated variant.

ACCEPTANCE CRITERIA: detectedType (installed variant) Extract<...> and required; "missing a resolved type" runtime throw removed; manifestTypeFromDetected accepts discriminated variant keyed on t.type; npm test + type-check pass, no any/cast escape hatch.

STATUS: Complete

SPEC CONTEXT: Collection is transport not stored — each installed member its own entry recording own resolved skill/plugin type; not-agntc + nested members skipped before any entry. The narrowing encodes this invariant statically instead of re-proving at runtime.

IMPLEMENTATION: Implemented (fully converged).
- src/summary.ts:112-127 PluginInstallResult split into discriminated variants; installed variant carries REQUIRED detectedType: Extract<DetectedType,{type:"bare-skill"|"plugin"}> (119); skipped/failed omits it. Doc comment (101-111).
- src/commands/add.ts:705-712 installed push writes detectedType: pluginDetected (already narrowed by control-flow — not-agntc continue 570-579, collection continue 581-590); staging array pluginsToInstall declares same Extract<...> at 535.
- :725-742 manifest loop guards if(result.status!=="installed") continue (728) → statically narrows; result.detectedType (735) flows into buildAddEntry, no runtime guard. Comment 729-732.
- src/manifest.ts:59-63 manifestTypeFromDetected(t: Extract<...>) keys on t.type. Doc 50-58 anchors mapping to union.
- :63-80 both call sites (standalone 410, collection 734) route through buildAddEntry passing narrowed opts.detected (64) to manifestTypeFromDetected (76).
- Old result.detectedType?.type optional-chain + throw fully gone (grep "missing a resolved type" / .detectedType?. in src returns nothing). Do steps 3-4 satisfied through single shared buildAddEntry seam (improvement — mapping expressed once).

TESTS: Adequate. tests/manifest.test.ts:665-681 manifestTypeFromDetected exercised with discriminated variant objects ({type:"bare-skill"}, {type:"plugin",assetDirs}), verifies keys on t.type + never returns literal bare-skill. tests/commands/add.test.ts:746-820 standalone recorded-type cases; :961 mixed; :1334 member resolved type; :1361 configless+config-bearing; :1402 skipped no entry; :1427 direct-path — exercise the values flowing through the narrowed seam (behavioural proof deleted throw unreachable). Mock keeps real manifestTypeFromDetected/buildManifestEntry (99-103). Deleted throw correctly NOT replaced by impossible-by-construction test. (Note: tests read not executed; "npm test passes" asserted by implementer.)

CODE QUALITY: Conventions followed (Extract<Union,Discriminant> anchors type — derive don't restate; control-flow narrowing via continue guards not casts). SOLID good (manifestTypeFromDetected/buildAddEntry/memberKey single responsibilities; discriminated PluginInstallResult puts detectedType only on owning variant — interface segregation). Complexity low (loop dropped the throw branch, replaced by continue guard doubling as narrowing). Modern idioms (discriminated unions, Extract, control-flow narrowing). Readability good (why-no-runtime-guard comment + union doc).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
