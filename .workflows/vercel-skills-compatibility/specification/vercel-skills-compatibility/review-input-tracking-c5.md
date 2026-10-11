# Review Tracking: vercel-skills-compatibility - Input Review

## Findings

### 1. An `ssh://` GitHub or GitLab URL is cloned over SSH, where Vercel clones it over https

**Source**: No source decides this. Checked in `discussion/vercel-skills-compatibility.md`: Like-for-Like Scope (private repos work wherever the user's own git credentials work; Vercel's credential chain not adopted), Fragment and Subpath Forms ("Adopt Vercel's source forms", no exception for any form), Website vs Git URLs (git sources read in Vercel's order; self-hosted servers reached by `.git` or SSH), and the Summary's Key Insight 3 (the full list of accepted divergences, which does not include this one). `grep -n "ssh" discussion/vercel-skills-compatibility.md` finds no passage on how an `ssh://` URL is cloned.
**Category**: Unsourced decision
**Move**: route
**Affects**: §2.1 Source forms (the bullet on SSH addresses and `https://….git` URLs)

**Problem**:
A pasted `ssh://git@github.com/owner/repo.git`, or the same form on gitlab.com, is cloned over SSH exactly as given. Vercel's CLI reads that line as a GitHub or GitLab repository and clones it over https. Each reading breaks a different user on the binary swap:
- **Cloned over SSH:** the line fails for a user with no SSH key set up, and that includes public repositories. Vercel installs those from the same line. The user sees a git authentication error ("Permission denied (publickey)") on a line that worked before the swap.
- **Cloned over https:** the line fails for a user whose only credential for a private repository is an SSH key.

Both sides cost someone, so this is not a derivation with one live answer. It decides which users the swap breaks. That is the owner's call, and the owner has not made it: the decided source forms follow Vercel with no exception for this form, and the accepted divergences do not include it.

**Proposed Text**:

**Resolution**: Pending
**Notes**:

---

## Observations

- Vercel's member picker shows each skill's description beside its name (the discussion's Vercel surface and Pre-Install Summary context). The specification puts descriptions in the summary and `--list` but says nothing about the menu itself, though "follows Vercel's order" probably covers it.
- Two skills in different category folders that declare no name but share a folder name end up with one identity, one install folder and one key. The dedup rule (first in priority order kept) covers only skills that declare the same name.
