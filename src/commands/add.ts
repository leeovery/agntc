import { Command } from "commander";
import * as p from "@clack/prompts";
import { parseSource } from "../source-parser.js";
import { cloneSource, cleanupTempDir } from "../git-clone.js";
import { readConfig } from "../config.js";
import { detectType } from "../type-detection.js";
import {
  getRegisteredAgentIds,
  getDriver,
} from "../drivers/registry.js";
import { selectAgents } from "../agent-select.js";
import { copyBareSkill } from "../copy-bare-skill.js";
import { readManifest, writeManifest, addEntry } from "../manifest.js";
import { ExitSignal } from "../exit-signal.js";
import type { AgentId } from "../drivers/types.js";

export async function runAdd(source: string): Promise<void> {
  p.intro("agntc add");

  let tempDir: string | undefined;

  try {
    // 1. Parse source
    const parsed = parseSource(source);

    // 2. Clone source (with spinner)
    const spin = p.spinner();
    spin.start("Cloning repository...");
    let cloneResult;
    try {
      cloneResult = await cloneSource(parsed);
    } catch (err) {
      spin.stop("Clone failed");
      throw err;
    }
    spin.stop("Cloned successfully");
    tempDir = cloneResult.tempDir;

    // 3. Read config
    const onWarn = (message: string) => p.log.warn(message);
    const config = await readConfig(tempDir, { onWarn });

    // 4. Handle null config (collection) — not yet supported
    if (config === null) {
      p.outro("Collections are not yet supported");
      throw new ExitSignal(0);
      return;
    }

    // 5. Detect type
    const detected = await detectType(tempDir, {
      hasConfig: true,
      onWarn,
    });

    // 6. Handle non-bare-skill types
    if (detected.type === "plugin") {
      p.outro("Plugins are not yet supported");
      throw new ExitSignal(0);
      return;
    }

    if (detected.type === "not-agntc") {
      p.outro("Not a recognized agntc package — not yet supported");
      throw new ExitSignal(0);
      return;
    }

    if (detected.type === "collection") {
      p.outro("Collections are not yet supported");
      throw new ExitSignal(0);
      return;
    }

    // 7. Detect agents
    const projectDir = process.cwd();
    const registeredIds = getRegisteredAgentIds();
    const detectedAgents: AgentId[] = [];

    for (const id of registeredIds) {
      const driver = getDriver(id);
      if (await driver.detect(projectDir)) {
        detectedAgents.push(id);
      }
    }

    // 8. Select agents
    const selectedAgents = await selectAgents({
      declaredAgents: config.agents as AgentId[],
      detectedAgents,
    });

    if (selectedAgents.length === 0) {
      p.cancel("Cancelled — no agents selected");
      throw new ExitSignal(0);
      return;
    }

    // 9. Build agent+driver pairs for copy
    const agents = selectedAgents.map((id) => ({
      id,
      driver: getDriver(id),
    }));

    // 10. Copy bare skill (with spinner)
    spin.start("Copying skill files...");
    let copyResult;
    try {
      copyResult = await copyBareSkill({
        sourceDir: tempDir,
        projectDir,
        agents,
      });
    } catch (err) {
      spin.stop("Copy failed");
      throw err;
    }
    spin.stop("Copied successfully");

    // 11. Write manifest
    const manifest = await readManifest(projectDir);
    const entry = {
      ref: parsed.ref,
      commit: cloneResult.commit,
      installedAt: new Date().toISOString(),
      agents: selectedAgents as string[],
      files: copyResult.copiedFiles,
    };
    const updated = addEntry(manifest, parsed.manifestKey, entry);
    await writeManifest(projectDir, updated);

    // 12. Summary
    const agentSummary = selectedAgents
      .map((id) => {
        const driver = getDriver(id);
        const targetPrefix = driver.getTargetDir("skills");
        const count = copyResult.copiedFiles.filter(
          (f) => targetPrefix !== null && f.startsWith(targetPrefix),
        ).length;
        return `${id}: ${count} skill(s)`;
      })
      .join(", ");

    p.outro(
      `Installed ${parsed.manifestKey}@${parsed.ref ?? "HEAD"} — ${agentSummary}`,
    );
  } catch (err) {
    if (err instanceof ExitSignal) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    p.cancel(message);
    throw new ExitSignal(1);
  } finally {
    if (tempDir) {
      try {
        await cleanupTempDir(tempDir);
      } catch {
        // Swallow cleanup errors
      }
    }
  }
}

export const addCommand = new Command("add")
  .description("Install a plugin from a git repo or local path")
  .argument("<source>", "Git repo (owner/repo) or local path")
  .action(async (source: string) => {
    try {
      await runAdd(source);
    } catch (err) {
      if (err instanceof ExitSignal) {
        process.exit(err.code);
      }
      throw err;
    }
  });
