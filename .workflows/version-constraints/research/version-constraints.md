# Research: Version Constraints

Exploring Composer-style version constraint syntax for plugin installation and updates, allowing users to control the scope of automatic updates (major, minor, patch).

## Starting Point

What we know so far:
- agntc already supports installing plugins at a specific git tag/ref
- User wants Composer-like version constraint syntax (e.g. ^1.0, ~1.0) to control update scope
- The `update` command should respect constraints to determine which versions to pull
- Three update scopes needed: major, minor, patch — user chooses at install time
- Constraints should be independent of any config settings — stored with the installation

---
