import { execFile } from "node:child_process";
import type { ManifestEntry } from "./manifest.js";

export type UpdateCheckResult =
  | { status: "local" }
  | { status: "up-to-date" }
  | { status: "update-available"; remoteCommit: string }
  | { status: "newer-tags"; tags: string[] }
  | { status: "check-failed"; reason: string };

function execGit(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { timeout: 15_000 },
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          const gitError = Object.assign(
            new Error(stderr || error.message),
            { stderr: stderr || "" },
          );
          reject(gitError);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

// Only valid for owner/repo keys (not local path keys).
function deriveCloneUrl(key: string): string {
  const parts = key.split("/");
  const owner = parts[0]!;
  const repo = parts[1]!;
  return `https://github.com/${owner}/${repo}.git`;
}

// Heuristic: matches "v1...", "1...", etc. Does not match branch names like
// "dev", "main", or "feature-x". Will misclassify tags that start with a
// non-numeric, non-v prefix (e.g. "release-1.0").
function isTagRef(ref: string): boolean {
  return /^v?\d/.test(ref);
}

function parseLsRemoteSha(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed === "") return null;
  const firstLine = trimmed.split("\n")[0]!;
  const sha = firstLine.split("\t")[0]!.trim();
  return sha || null;
}

function parseAllTags(stdout: string): string[] {
  const trimmed = stdout.trim();
  if (trimmed === "") return [];
  return trimmed
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => !line.includes("^{}"))
    .map((line) => {
      const ref = line.split("\t")[1]!.trim();
      return ref.replace("refs/tags/", "");
    });
}

function findNewerTags(allTags: string[], currentTag: string): string[] | null {
  const currentIndex = allTags.indexOf(currentTag);
  if (currentIndex === -1) return null;
  return allTags.slice(currentIndex + 1);
}

export async function checkForUpdate(
  key: string,
  entry: ManifestEntry,
): Promise<UpdateCheckResult> {
  if (entry.ref === null && entry.commit === null) {
    return { status: "local" };
  }

  const url = deriveCloneUrl(key);

  if (entry.ref === null) {
    return checkHead(url, entry.commit!);
  }

  if (isTagRef(entry.ref)) {
    return checkTag(url, entry.ref, entry.commit!);
  }

  return checkBranch(url, entry.ref, entry.commit!);
}

async function checkHead(
  url: string,
  installedCommit: string,
): Promise<UpdateCheckResult> {
  try {
    const { stdout } = await execGit(["ls-remote", url, "HEAD"]);
    const remoteSha = parseLsRemoteSha(stdout);
    if (remoteSha === null) {
      return { status: "check-failed", reason: "No HEAD ref found on remote" };
    }
    if (remoteSha === installedCommit) {
      return { status: "up-to-date" };
    }
    return { status: "update-available", remoteCommit: remoteSha };
  } catch (err: unknown) {
    return {
      status: "check-failed",
      reason: (err as Error).message,
    };
  }
}

async function checkBranch(
  url: string,
  branch: string,
  installedCommit: string,
): Promise<UpdateCheckResult> {
  try {
    const { stdout } = await execGit([
      "ls-remote",
      url,
      `refs/heads/${branch}`,
    ]);
    const remoteSha = parseLsRemoteSha(stdout);
    if (remoteSha === null) {
      return {
        status: "check-failed",
        reason: `Branch '${branch}' not found on remote`,
      };
    }
    if (remoteSha === installedCommit) {
      return { status: "up-to-date" };
    }
    return { status: "update-available", remoteCommit: remoteSha };
  } catch (err: unknown) {
    return {
      status: "check-failed",
      reason: (err as Error).message,
    };
  }
}

async function checkTag(
  url: string,
  tag: string,
  _installedCommit: string,
): Promise<UpdateCheckResult> {
  try {
    const { stdout } = await execGit(["ls-remote", "--tags", url]);
    const allTags = parseAllTags(stdout);
    const newerTags = findNewerTags(allTags, tag);
    if (newerTags === null) {
      return {
        status: "check-failed",
        reason: `Tag '${tag}' not found on remote`,
      };
    }
    if (newerTags.length > 0) {
      return { status: "newer-tags", tags: newerTags };
    }
    return { status: "up-to-date" };
  } catch (err: unknown) {
    return {
      status: "check-failed",
      reason: (err as Error).message,
    };
  }
}
