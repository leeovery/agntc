# Discussion: Version Constraints

## Context

agntc needs Composer-style version constraint syntax for plugin installations so users can control the scope of automatic updates. Currently, tag-pinned installs (`owner/repo@v1.0.0`) refuse to auto-update entirely — there's no middle ground between "pinned exactly" and "track HEAD."

The research phase established that `^` (caret) and `~` (tilde) are dominant operators across npm, Composer, Cargo, and Bundler with consistent semantics. The proposed model uses the existing `@` syntax: `owner/repo@^1` for major-pinned, `owner/repo@~1.2` for minor-pinned, and bare tags for exact pin.

Key constraints:
- Must integrate with existing ref/commit tracking in the manifest
- Must work with the nuke-and-reinstall update strategy
- Parser must distinguish constraints from literal git refs (unambiguous since no git ref starts with `^` or `~`)

### References

- [Version Constraints Research](./../research/version-constraints.md)

## Questions

- [ ] How should the manifest store constraints vs resolved versions?
      - Current manifest has `ref` (user-specified) and `commit` (resolved SHA)
      - Need to store the constraint expression separately from the resolved tag
- [ ] What should `update` output look like when a newer major version exists but the constraint blocks it?
      - UX question: inform, warn, or silently skip?
- [ ] How should pre-1.0 versions be handled?
      - Cargo/Composer treat `^0.x` specially (minor becomes the breaking boundary)
      - Do we need this complexity or can we keep it simple?
- [ ] Should `add` without any constraint on a tagged repo default to caret behavior, or stay as exact pin?
      - Ergonomics vs explicitness trade-off
- [ ] What is the version resolution algorithm?
      - How do we select the best matching tag from ls-remote output?
      - How do we handle non-semver tags?
- [ ] How should constraint violations during `update` be reported?
      - Single plugin vs batch update scenarios

---

*Each question above gets its own section below. Check off as completed.*

---

## Summary

### Key Insights

### Current State
- Questions identified, discussion not yet started

### Next Steps
- [ ] Work through each question
