TASK: configless-install-4-3 — Add a type backfill loop in readManifest deriving 'skill'|'plugin' from each legacy entry's LOCAL files (anti-drift: never re-clone/re-detect/read config), persisted on next write. deriveTypeFromFiles pure, total, non-throwing.

ACCEPTANCE CRITERIA: agents/hooks target → plugin; multiple skill dirs under one key → plugin; single skills dir → skill (single-skill ambiguity accepted); existing type not overwritten; per-agent skills targets recognised; empty files → skill no error; legacy manifest never errors; list/remove receive backfilled type, persists on next write; derives from local files only.

STATUS: Complete

SPEC CONTEXT: Manifest Keying & Lifecycle → Legacy backfill — backfill from recorded files (local = ground truth), NOT re-clone/re-detect (first update re-clones current remote where author may have dropped agntc.json → would flip plugin to collection). agents/hooks or multiple skill dirs → plugin; single .claude/skills/<name>/ → skill. Per-entry, always a unit. In-memory on read (mirror cloneUrl), persisted next write, available to list/remove/update. type optional; never errors; total.

IMPLEMENTATION: Implemented. src/manifest.ts.
- :90-97 type backfill loop after cloneUrl loop (84-88), before return (99); guards !("type" in entry); entry.type = deriveTypeFromFiles(entry.files ?? []).
- :111-129 deriveTypeFromFiles: iterates files, identifyFileOwnership (drivers/identify.ts:11), plugin on any agents/hooks-owned, collects distinct skill dirs, >1 → plugin else skill.
- :135-143 skillDirName helper: slices getTargetDir("skills").length, strips leading slashes, first segment; null when empty.
- Anti-drift: reads only entry.files via pure path inspection; no clone/detect/config-read. Total/non-throwing: null ownership → continue; empty/all-unrecognised → skill. Target-dir slicing verified against real driver values (.claude/skills, .agents/skills, .cursor/skills). Same skill dir across multiple agent targets collapses to one (Set) → skill.
- list/remove consume via readManifestOrExit → readManifest, receive backfilled type; neither requires it.

TESTS: Adequate. tests/manifest.test.ts describe("type backfill on read") 683-957: agents→plugin (694); hooks→plugin (711); multiple skill dirs→plugin (728); single skill dir→skill (745); does-not-overwrite (762); per-agent targets claude/codex/cursor (780); same dir multi-target→single skill (815); empty files→skill (832); all-unrecognised→skill (849); legacy never errors (866); legacy collection-member backfills from own files never collection (889); persists on next writeManifest reads raw file back (918); cloneUrl+type coexist (941). Behaviour-focused (persistence test reparses written file). Not over/under-tested.

CODE QUALITY: Conventions followed (mirrors cloneUrl backfill idiom; uses getDriver/identifyFileOwnership seam not hard-coded paths). SOLID good (deriveTypeFromFiles pure single-responsibility; skillDirName focused; delegates classification to driver registry — DI preserved). Complexity low. Modern idioms (Set, destructuring, ??). Readability good (doc comment states anti-drift rationale + three-way rule).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES: None.
