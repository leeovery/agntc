---
topic: plugin-init-scaffolding
date: 2026-02-09
---

# Research: Plugin/Collection Init Scaffolding Command

Exploring the idea of an `npx agntc init` command that scaffolds new plugin or collection repos. Rather than requiring authors to know all the conventions (agntc.json, asset dirs, bare skills, collection structure), the tool would ask questions and generate the right structure.

## Starting Point

What we know so far:
- Conventions for plugins/collections are well-defined (core-architecture discussion, concluded)
- Plugin = atomic unit, collection = repo of selectable plugins
- `agntc.json` marks boundaries and carries metadata
- Asset dirs: `skills/`, `agents/`, `scripts/`, `hooks/`, `rules/`
- Bare skill fallback: `SKILL.md` at plugin root
- No existing init/scaffolding code in the project
- @clack/prompts already chosen as the CLI prompt library
- `commander` already a dependency

---

## The Core Idea

An `npx agntc init` command that:

1. Asks: plugin or collection?
2. Asks about target agents (claude, codex, cursor, etc.)
3. Asks what asset types you'll include
4. Generates the directory structure, `agntc.json`, and starter files

Removes the need for plugin authors to read docs about conventions — the tool teaches through interaction.

---

## Audience and Context

This is a **plugin author tool**, not a consumer tool. The author has already created their repo — maybe they've got skills, agents, scripts in some structure. `npx agntc init` helps them package it correctly so it's installable via `npx agntc add`. It runs in the author's plugin repo, not in a consumer's project.

---

## Two Modes: Greenfield vs Brownfield

Supports both:
- **Greenfield** — empty repo, scaffold everything from scratch (dirs, `agntc.json`, starter files)
- **Brownfield** — existing code already present, detect the structure and fill in gaps (generate `agntc.json`, confirm conventions are right)

### Auto-detection with confirmation

In brownfield mode, the tool scans what's already there and infers the type:
- Asset dirs at root (`skills/`, `agents/`, etc.) → looks like a plugin
- Subdirs containing asset dirs → looks like a collection
- `SKILL.md` at root with no asset dirs → looks like a bare skill

Then confirms with the author: "This looks like a plugin — correct?" rather than asking from scratch. Author can override if the detection is wrong.
