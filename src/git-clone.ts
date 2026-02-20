import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ParsedSource } from "./source-parser.js";

export interface CloneResult {
  tempDir: string;
  commit: string;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [500, 1000];

const AUTH_ERROR_PATTERNS = [
  "Authentication",
  "Permission denied",
  "could not read Username",
  "could not read Password",
];

function isAuthError(stderr: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => stderr.includes(pattern));
}

function execGit(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: 60_000 },
      (error, stdout, stderr) => {
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCloneUrl(parsed: ParsedSource): string {
  if (parsed.type === "https-url") {
    return parsed.cloneUrl;
  }
  return `https://github.com/${parsed.owner}/${parsed.repo}.git`;
}

export async function cloneSource(parsed: ParsedSource): Promise<CloneResult> {
  const url = resolveCloneUrl(parsed);
  const tempDir = await mkdtemp(tmpdir() + "/agntc-");

  const cloneArgs = ["clone", "--depth", "1"];
  if (parsed.ref !== null) {
    cloneArgs.push("--branch", parsed.ref);
  }
  cloneArgs.push(url, tempDir);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await execGit(cloneArgs);
      const { stdout } = await execGit(["-C", tempDir, "rev-parse", "HEAD"]);
      const commit = stdout.trim();
      return { tempDir, commit };
    } catch (err: unknown) {
      lastError = err as Error;
      const stderr = (err as { stderr?: string }).stderr ?? "";

      if (isAuthError(stderr)) {
        await rm(tempDir, { recursive: true, force: true });
        throw new Error(
          `git clone failed: ${stderr || (err as Error).message}`,
        );
      }

      if (attempt < MAX_ATTEMPTS) {
        await delay(RETRY_DELAYS[attempt - 1]!);
      }
    }
  }

  await rm(tempDir, { recursive: true, force: true });
  throw new Error(
    `git clone failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

export async function cleanupTempDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
