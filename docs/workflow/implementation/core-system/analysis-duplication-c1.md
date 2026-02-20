AGENT: duplication
FINDINGS:
- FINDING: Nuke-and-reinstall pipeline duplicated across 6 functions in 3 files
  SEVERITY: high
  FILES: src/commands/update.ts:123-266, src/commands/update.ts:286-380, src/commands/update.ts:390-512, src/commands/update.ts:514-637, src/commands/list-update-action.ts:57-180, src/commands/list-update-action.ts:182-294, src/commands/list-change-version-action.ts:78-192
  DESCRIPTION: The core update pipeline — readConfig, computeEffectiveAgents/findDroppedAgents with warning messages, detectType, build agent+driver pairs, nukeManifestFiles, conditional copy (plugin vs bare-skill), construct ManifestEntry — is independently implemented in 6+ functions across 3 files. The functions are runGitUpdate, runLocalUpdate, processGitUpdateForAll, processLocalUpdateForAll (all in update.ts), runRemoteUpdate and runLocalUpdate (in list-update-action.ts), and executeChangeVersionAction (in list-change-version-action.ts). Each reimplements the same ~40-line sequence with only minor variations in error handling style (throw vs return result object) and which fields go into the ManifestEntry. The dropped-agents warning message string is copy-pasted identically across all of them.
  RECOMMENDATION: Extract a shared function (e.g. `executeNukeAndReinstall`) that takes a sourceDir, entry, key, projectDir, and an options bag (onWarn, ref/commit for the new entry) and returns the new ManifestEntry + copiedFiles. Each call site reduces to: resolve sourceDir, call the shared pipeline, handle the result per its own error convention. This would consolidate ~250 lines of near-identical logic into one ~50-line function plus thin call-site wrappers.

- FINDING: buildParsedSource and getSourceDir duplicated across 3 files
  SEVERITY: medium
  FILES: src/commands/update.ts:37-61, src/commands/list-update-action.ts:35-55, src/commands/list-change-version-action.ts:23-40
  DESCRIPTION: Both `buildParsedSource(key, ...)` and `getSourceDir(tempDir, key)` are independently implemented in update.ts, list-update-action.ts, and list-change-version-action.ts. The implementations are nearly identical — buildParsedSource splits the key on "/" to extract owner/repo and constructs a ParsedSource, and getSourceDir joins the remaining key segments onto tempDir. The list-change-version-action version takes slightly different args (ref as separate param vs from entry) but the logic is the same.
  RECOMMENDATION: Extract both into a shared module (e.g. `src/manifest-key-utils.ts` or add to `source-parser.ts`). buildParsedSource should accept `(key: string, ref: string | null)` to cover both calling conventions.

- FINDING: isNodeError type guard duplicated in 3 files
  SEVERITY: medium
  FILES: src/config.ts:73-75, src/manifest.ts:56-58, src/nuke-files.ts:9-11
  DESCRIPTION: The identical function `isNodeError(err: unknown): err is NodeJS.ErrnoException` checking `err instanceof Error && "code" in err` is defined independently in config.ts, manifest.ts, and nuke-files.ts.
  RECOMMENDATION: Extract to a shared utility module (e.g. `src/fs-utils.ts` or `src/errors.ts`) and import from there.

- FINDING: AgentWithDriver interface duplicated in 3 files
  SEVERITY: medium
  FILES: src/copy-bare-skill.ts:6-9, src/copy-plugin-assets.ts:7-10, src/compute-incoming-files.ts:4-7
  DESCRIPTION: The `AgentWithDriver` interface (`{ id: AgentId; driver: AgentDriver }`) is independently declared in copy-bare-skill.ts, copy-plugin-assets.ts, and compute-incoming-files.ts. All three define the exact same shape.
  RECOMMENDATION: Export `AgentWithDriver` from `src/drivers/types.ts` alongside the existing `AgentId` and `AgentDriver` types, and import it in the three consuming files.

- FINDING: execGit helper duplicated in 2 files with different timeouts
  SEVERITY: medium
  FILES: src/git-clone.ts:25-47, src/update-check.ts:11-32
  DESCRIPTION: Both git-clone.ts and update-check.ts define their own `execGit` wrapper around child_process.execFile. The implementations are structurally identical — they wrap execFile in a promise, construct a git error with stderr, and resolve/reject. The only difference is the timeout (60s for clone, 15s for update-check). This is copy-paste drift waiting to happen.
  RECOMMENDATION: Extract a shared `execGit(args, options?)` into a `src/git-utils.ts` module that accepts an optional timeout parameter (defaulting to a sensible value). Both call sites pass their desired timeout.

- FINDING: File classification by path duplicated in 2 files
  SEVERITY: low
  FILES: src/commands/list-detail.ts:41-48, src/commands/remove.ts:61-66
  DESCRIPTION: Both list-detail.ts (`classifyAssetType`) and remove.ts (`classifyFile`) implement the same logic: check if a file path includes "/skills/", "/agents/", or "/hooks/" and return the category. The return values differ only in casing ("skills" vs "Skills") but the pattern-matching logic is identical.
  RECOMMENDATION: Extract a shared `classifyAssetType(filePath)` function and normalize the casing at the call site. Low severity since each is only ~6 lines, but consolidation would prevent drift.

- FINDING: tempDir cleanup pattern repeated in 4 locations
  SEVERITY: low
  FILES: src/commands/add.ts:249-256, src/commands/update.ts:257-265, src/commands/list-update-action.ts:171-179, src/commands/list-change-version-action.ts:183-191
  DESCRIPTION: The finally-block pattern `if (tempDir) { try { await cleanupTempDir(tempDir); } catch { } }` is repeated identically in 4 locations across 4 files. Each swallows cleanup errors silently.
  RECOMMENDATION: This would be naturally resolved by extracting the nuke-and-reinstall pipeline (finding 1), as the tempDir lifecycle would be managed in one place. If addressed independently, a small `safeTempCleanup(tempDir?: string)` helper could be extracted, though the pattern is only 5 lines each.

SUMMARY: The dominant duplication is the nuke-and-reinstall pipeline, which is independently implemented 6+ times across update.ts, list-update-action.ts, and list-change-version-action.ts. This is a clear case of isolated task executors rebuilding the same core operation. Consolidating this into a shared function would eliminate ~200 lines of near-duplicate code and several satellite duplications (buildParsedSource, getSourceDir, tempDir cleanup) that exist only because the pipeline was duplicated.
