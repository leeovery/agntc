AGENT: standards
FINDINGS:
- FINDING: Collection add installs all selected agents for all plugins regardless of per-plugin declarations
  SEVERITY: medium
  FILES: /Users/leeovery/Code/agntc/src/commands/add.ts:319-365
  DESCRIPTION: The spec says the agent multiselect should display unsupported-agent warnings per plugin ("Agents not listed in the plugin's `agents` field are still shown in the multiselect but display a warning"). For collections, the implementation unions all declared agents across all selected plugins and passes that union to `selectAgents`. This means if plugin A declares `["claude"]` and plugin B declares `["codex"]`, both agents appear without any unsupported warning. Worse, the resulting selected agents are applied uniformly to ALL plugins -- plugin A gets installed for codex (which it never declared), and plugin B gets installed for claude (which it never declared), with no per-plugin warning. The spec explicitly states "No inheritance -- every installable unit declares its own `agents`, even within collections", and unsupported agents should show a warning.
  RECOMMENDATION: Either (a) show the agent multiselect per-plugin (matching standalone behavior), or (b) continue with a single multiselect but during the copy phase, filter each plugin's agents to only include what the user selected AND emit a warning for any selected agent not in that plugin's declared agents. Option (b) preserves the current single-prompt UX while aligning with spec intent.

- FINDING: Manifest entry includes cloneUrl field not specified in the manifest schema
  SEVERITY: low
  FILES: /Users/leeovery/Code/agntc/src/manifest.ts:13, /Users/leeovery/Code/agntc/src/commands/add.ts:234
  DESCRIPTION: The spec defines manifest entry fields as: `ref`, `commit`, `installedAt`, `agents`, `files`. The implementation adds a `cloneUrl: string | null` field (manifest.ts:13) and stores it during add (add.ts:234). This field is used during update to derive the correct clone URL for non-GitHub sources (SSH URLs, GitLab, etc.), which is a practical necessity since the manifest key (`owner/repo`) alone cannot reconstruct the original clone URL. The spec's update semantics ("Re-clone at the same ref") implicitly require knowing the clone URL, so this field fills a real gap. However, it's an undeclared schema extension.
  RECOMMENDATION: This is a pragmatic addition that enables correct update behavior for non-GitHub sources. No code change needed, but the deviation should be noted for spec alignment.

- FINDING: Summary format uses single-line output instead of spec's multi-line per-agent format
  SEVERITY: low
  FILES: /Users/leeovery/Code/agntc/src/summary.ts:63-71
  DESCRIPTION: The spec defines the add summary format as multi-line with per-agent blocks on separate indented lines (e.g., "Claude:\n    12 skills, 3 agents, 2 hooks\n  Codex:\n    12 skills"). The implementation produces a compact single-line format: "Installed owner/repo@ref -- claude: 2 skill(s)". Also uses lowercase agent names where the spec uses capitalized ("Claude" vs "claude"). While functionally equivalent, this is a cosmetic divergence from the specified UX.
  RECOMMENDATION: Align the output format to use multi-line per-agent layout with capitalized agent names matching the spec's example output.

SUMMARY: One medium-severity finding: the collection add flow applies selected agents uniformly to all plugins without per-plugin unsupported-agent warnings, diverging from the spec's per-plugin agent compatibility model. Two low findings: an undeclared cloneUrl manifest field (pragmatic addition) and summary format divergence. All high/medium findings from cycle 1 have been addressed.
