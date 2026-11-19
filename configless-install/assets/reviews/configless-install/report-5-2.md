TASK: configless-install-5-2 — Symlink-escape pre-flight scan utility (clone-root boundary): scanForEscapingSymlinks(unitDir, cloneRoot) + SymlinkEscapeError. Walks tree, rejects symlinks resolving outside clone root; broken links lexical; no infinite loop on cycles. Utility + unit tests (wiring 5-3/5-4).

ACCEPTANCE CRITERIA: exports scanForEscapingSymlinks + SymlinkEscapeError; absolute-target rejected; ..-escape rejected; symlink inside clone allowed (incl sibling dir); broken lexically inside allowed; broken lexically escaping rejected; deeply-nested found; symlink-to-dir cycle terminates; no-symlink no-op; error names offending path+target; no fs writes.

STATUS: Complete

SPEC CONTEXT: Copy-Safety Hardening — symlink-escape guard protects copied content, runs on every install (bare skills incl), pre-flight before any copy; boundary = cloned repo root (within-clone allowed incl multi-dir plugin spanning dirs); broken links lexical.

IMPLEMENTATION: Implemented (no drift). src/copy-safety.ts:46-51 (SymlinkEscapeError); 74-104 (scanForEscapingSymlinks + scanDir); 130-145 (assertSymlinkContained); 10-13 (shared isContained).
- Walk: readdir(dir,{withFileTypes:true}), dirent.isSymbolicLink()/isDirectory(); symlinks validated then continue (never descended) → cycles can't be traversed, walk visits only finite real tree (93-102). (lstat not called directly — dirents report isSymbolicLink without following, correct equivalent.)
- Target resolution resolve(dirname(linkPath), target) (139) handles relative+absolute; never realpath/stat → identical lexical semantics for broken links (135-139).
- Containment via relative()-based isContained (boundary-correct); both args resolve-normalised (78-79).
- Fail-fast: throws SymlinkEscapeError(relPath, target) on FIRST escaping symlink (141-143); relPath relative to unitRoot, message includes rel + raw target. Pure: only readdir/readlink read-only, no writes/log/exit.
- checkEscapingSymlinks wrapper (115-128) also in module = analysis-4-2 deliverable, consumed by wiring sites; correctly out of scope for 5-2.

TESTS: Adequate. tests/copy-safety.test.ts:127-257 real temp-dir fixtures (mkdtemp+symlink): absolute-target reject (153); ..-escape reject (161); inside clone allow (169); sibling dir allow (178); broken lexically inside allow (189); broken lexically escaping reject (197); deeply-nested found (208); symlink-to-dir cycle terminates+allow (218); no-symlink no-op (143); validates symlinked dir without descending (229); error names rel+target+name (243). Cycle test (218) + 229 together pin "validated-not-descended". Would fail if continue removed (hang). Not over-tested.

CODE QUALITY: Conventions followed (tabs, node: imports, .js test, async/await; reuses isContained DRY). SOLID good (isContained pure predicate, assertSymlinkContained single-link validation, scanDir traversal, public orchestration; focused Error subclass). Complexity low (tail-recursive walk, single branch per dirent). Modern idioms (withFileTypes dirents avoid per-entry stat). Readability good (doc comments tie to spec).

BLOCKING ISSUES: None.

NON-BLOCKING NOTES:
- [quickfix] tests/copy-safety.test.ts:216 — add a test pinning fail-fast with a valid inner symlink plus a later escaping symlink (assert still rejects), to lock the "throw on FIRST escaping symlink" guarantee currently only covered transitively.
- [idea] src/copy-safety.ts:88 — readdir awaited per-directory sequentially during recursion (serial walk). Fine for plugin-sized trees (spec defers size caps), but if large untrusted repos become a concern, parallelising sibling descent or capping depth/count is worth deciding.
