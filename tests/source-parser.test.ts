import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseSource, buildParsedSourceFromKey, getSourceDirFromKey } from "../src/source-parser.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";

describe("parseSource", () => {
  it("parses owner/repo into structured source with null ref", async () => {
    const result = await parseSource("owner/repo");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: null,
      manifestKey: "owner/repo",
    });
  });

  it("parses owner/repo@ref with tag ref", async () => {
    const result = await parseSource("owner/repo@v2.0");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v2.0",
      manifestKey: "owner/repo",
    });
  });

  it("parses owner/repo@ref with branch name ref", async () => {
    const result = await parseSource("owner/repo@main");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "main",
      manifestKey: "owner/repo",
    });
  });

  it("returns manifestKey as owner/repo", async () => {
    const result = await parseSource("alice/my-skills@v1.0");
    expect(result.manifestKey).toBe("alice/my-skills");
  });

  it("trims whitespace from input", async () => {
    const result = await parseSource("  owner/repo  ");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: null,
      manifestKey: "owner/repo",
    });
  });

  it("throws for missing owner segment (bare repo name)", async () => {
    await expect(parseSource("repo")).rejects.toThrow(
      /must be in owner\/repo format/,
    );
  });

  it("treats leading slash as local path (not GitHub shorthand)", async () => {
    // /repo is now detected as a local path, not owner/repo with empty owner
    await expect(parseSource("/repo")).rejects.toThrow(
      /Path \/repo does not exist or is not a directory/,
    );
  });

  it("throws for empty repo (trailing slash)", async () => {
    await expect(parseSource("owner/")).rejects.toThrow(/repo cannot be empty/);
  });

  it("throws for empty ref after @ symbol", async () => {
    await expect(parseSource("owner/repo@")).rejects.toThrow(/ref cannot be empty/);
  });

  it("throws for extra slashes in path (three segments)", async () => {
    await expect(parseSource("a/b/c")).rejects.toThrow(
      /too many slashes/,
    );
  });

  it("throws for empty string input", async () => {
    await expect(parseSource("")).rejects.toThrow(/source cannot be empty/);
  });

  it("handles ref containing special characters (e.g., v2.0.0-beta.1)", async () => {
    const result = await parseSource("owner/repo@v2.0.0-beta.1");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v2.0.0-beta.1",
      manifestKey: "owner/repo",
    });
  });

  it("splits on first @ only - ref can contain @ characters", async () => {
    const result = await parseSource("owner/repo@feat@special");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "feat@special",
      manifestKey: "owner/repo",
    });
  });

  describe("HTTPS URL sources", () => {
    it("parses GitHub HTTPS URL with owner/repo", async () => {
      const result = await parseSource("https://github.com/owner/repo");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses GitLab HTTPS URL", async () => {
      const result = await parseSource("https://gitlab.com/org/project");
      expect(result).toEqual({
        type: "https-url",
        owner: "org",
        repo: "project",
        ref: null,
        manifestKey: "org/project",
        cloneUrl: "https://gitlab.com/org/project.git",
      });
    });

    it("parses Bitbucket HTTPS URL", async () => {
      const result = await parseSource("https://bitbucket.org/team/tools");
      expect(result).toEqual({
        type: "https-url",
        owner: "team",
        repo: "tools",
        ref: null,
        manifestKey: "team/tools",
        cloneUrl: "https://bitbucket.org/team/tools.git",
      });
    });

    it("parses HTTPS URL with @ref suffix", async () => {
      const result = await parseSource("https://github.com/owner/repo@v1.0");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: "v1.0",
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses HTTPS URL with branch ref", async () => {
      const result = await parseSource("https://gitlab.com/org/project@main");
      expect(result).toEqual({
        type: "https-url",
        owner: "org",
        repo: "project",
        ref: "main",
        manifestKey: "org/project",
        cloneUrl: "https://gitlab.com/org/project.git",
      });
    });

    it("strips trailing slash from URL", async () => {
      const result = await parseSource("https://github.com/owner/repo/");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips .git suffix from repo in URL", async () => {
      const result = await parseSource("https://github.com/owner/repo.git");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips both trailing slash and .git suffix", async () => {
      const result = await parseSource("https://github.com/owner/repo.git/");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips .git suffix before extracting ref", async () => {
      const result = await parseSource("https://github.com/owner/repo.git@v2.0");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: "v2.0",
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("manifestKey is host-independent (owner/repo only)", async () => {
      const github = await parseSource("https://github.com/owner/repo");
      const gitlab = await parseSource("https://gitlab.com/owner/repo");
      expect(github.manifestKey).toBe("owner/repo");
      expect(gitlab.manifestKey).toBe("owner/repo");
    });

    it("trims whitespace from HTTPS URL input", async () => {
      const result = await parseSource("  https://github.com/owner/repo  ");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("throws for HTTPS URL with no path segments", async () => {
      await expect(parseSource("https://github.com")).rejects.toThrow();
    });

    it("throws for HTTPS URL with single path segment", async () => {
      await expect(parseSource("https://github.com/owner")).rejects.toThrow();
    });

    it("throws for HTTPS URL with empty ref after @", async () => {
      await expect(parseSource("https://github.com/owner/repo@")).rejects.toThrow(
        /ref cannot be empty/,
      );
    });

    it("supports self-hosted git hosts", async () => {
      const result = await parseSource("https://git.mycompany.com/team/project");
      expect(result).toEqual({
        type: "https-url",
        owner: "team",
        repo: "project",
        ref: null,
        manifestKey: "team/project",
        cloneUrl: "https://git.mycompany.com/team/project.git",
      });
    });
  });

  describe("SSH URL sources", () => {
    it("parses git@github.com:owner/repo.git without ref", async () => {
      const result = await parseSource("git@github.com:owner/repo.git");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("parses git@github.com:owner/repo.git@v1.0 with tag ref", async () => {
      const result = await parseSource("git@github.com:owner/repo.git@v1.0");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: "v1.0",
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("parses SSH URL with branch ref", async () => {
      const result = await parseSource("git@github.com:owner/repo.git@main");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: "main",
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("handles missing .git suffix by adding it to cloneUrl", async () => {
      const result = await parseSource("git@github.com:owner/repo");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("handles missing .git suffix with ref", async () => {
      const result = await parseSource("git@github.com:owner/repo@v2.0");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: "v2.0",
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("supports non-GitHub hosts (GitLab)", async () => {
      const result = await parseSource("git@gitlab.com:org/project.git");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "org",
        repo: "project",
        ref: null,
        manifestKey: "org/project",
        cloneUrl: "git@gitlab.com:org/project.git",
      });
    });

    it("supports non-GitHub hosts (Bitbucket)", async () => {
      const result = await parseSource("git@bitbucket.org:team/tools.git@v3.0");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "team",
        repo: "tools",
        ref: "v3.0",
        manifestKey: "team/tools",
        cloneUrl: "git@bitbucket.org:team/tools.git",
      });
    });

    it("supports self-hosted git hosts", async () => {
      const result = await parseSource("git@git.mycompany.com:team/project.git");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "team",
        repo: "project",
        ref: null,
        manifestKey: "team/project",
        cloneUrl: "git@git.mycompany.com:team/project.git",
      });
    });

    it("manifestKey is owner/repo regardless of host", async () => {
      const github = await parseSource("git@github.com:owner/repo.git");
      const gitlab = await parseSource("git@gitlab.com:owner/repo.git");
      expect(github.manifestKey).toBe("owner/repo");
      expect(gitlab.manifestKey).toBe("owner/repo");
    });

    it("trims whitespace from SSH URL input", async () => {
      const result = await parseSource("  git@github.com:owner/repo.git  ");
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });

    it("throws for malformed SSH URL missing colon", async () => {
      await expect(parseSource("git@github.com/owner/repo.git")).rejects.toThrow(
        /invalid SSH URL/,
      );
    });

    it("throws for malformed SSH URL missing owner/repo path", async () => {
      await expect(parseSource("git@github.com:")).rejects.toThrow(
        /invalid SSH URL/,
      );
    });

    it("throws for malformed SSH URL with only owner (no repo)", async () => {
      await expect(parseSource("git@github.com:owner")).rejects.toThrow(
        /invalid SSH URL/,
      );
    });

    it("throws for SSH URL with empty ref after @", async () => {
      await expect(parseSource("git@github.com:owner/repo.git@")).rejects.toThrow(
        /ref cannot be empty/,
      );
    });

    it("handles ref with special characters", async () => {
      const result = await parseSource(
        "git@github.com:owner/repo.git@v2.0.0-beta.1",
      );
      expect(result).toEqual({
        type: "ssh-url",
        owner: "owner",
        repo: "repo",
        ref: "v2.0.0-beta.1",
        manifestKey: "owner/repo",
        cloneUrl: "git@github.com:owner/repo.git",
      });
    });
  });

  describe("GitHub shorthand still works (no regression)", () => {
    it("simple owner/repo still returns github-shorthand type", async () => {
      const result = await parseSource("owner/repo");
      expect(result.type).toBe("github-shorthand");
    });

    it("owner/repo@ref still returns github-shorthand type", async () => {
      const result = await parseSource("owner/repo@v1.0");
      expect(result.type).toBe("github-shorthand");
    });
  });

  describe("HTTPS URL sources still work (no regression)", () => {
    it("HTTPS URL still returns https-url type", async () => {
      const result = await parseSource("https://github.com/owner/repo");
      expect(result.type).toBe("https-url");
    });

    it("HTTPS URL with ref still returns https-url type", async () => {
      const result = await parseSource("https://github.com/owner/repo@v1.0");
      expect(result.type).toBe("https-url");
    });
  });

  describe("direct path sources (tree URLs)", () => {
    it("parses tree URL with branch ref", async () => {
      const result = await parseSource(
        "https://github.com/owner/repo/tree/main/plugin-name",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "owner",
        repo: "repo",
        ref: "main",
        targetPlugin: "plugin-name",
        manifestKey: "owner/repo/plugin-name",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses tree URL with tag ref", async () => {
      const result = await parseSource(
        "https://github.com/owner/repo/tree/v2.0/my-plugin",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "owner",
        repo: "repo",
        ref: "v2.0",
        targetPlugin: "my-plugin",
        manifestKey: "owner/repo/my-plugin",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses tree URL with nested plugin path", async () => {
      const result = await parseSource(
        "https://github.com/owner/repo/tree/develop/nested/plugin",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "owner",
        repo: "repo",
        ref: "develop",
        targetPlugin: "nested/plugin",
        manifestKey: "owner/repo/nested/plugin",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses tree URL from non-GitHub host", async () => {
      const result = await parseSource(
        "https://gitlab.com/org/project/tree/main/my-skill",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "org",
        repo: "project",
        ref: "main",
        targetPlugin: "my-skill",
        manifestKey: "org/project/my-skill",
        cloneUrl: "https://gitlab.com/org/project.git",
      });
    });

    it("parses tree URL from self-hosted git host", async () => {
      const result = await parseSource(
        "https://git.mycompany.com/team/tools/tree/main/helper",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "team",
        repo: "tools",
        ref: "main",
        targetPlugin: "helper",
        manifestKey: "team/tools/helper",
        cloneUrl: "https://git.mycompany.com/team/tools.git",
      });
    });

    it("throws for @ref suffix on tree URL", async () => {
      await expect(
        parseSource("https://github.com/owner/repo/tree/main/plugin@v1.0"),
      ).rejects.toThrow(/tree URLs cannot have @ref suffix/);
    });

    it("throws for tree URL missing plugin path after ref", async () => {
      await expect(
        parseSource("https://github.com/owner/repo/tree/main"),
      ).rejects.toThrow(
        /invalid tree URL: missing plugin path after ref/,
      );
    });

    it("throws for tree URL missing ref and plugin", async () => {
      await expect(
        parseSource("https://github.com/owner/repo/tree/"),
      ).rejects.toThrow(
        /invalid tree URL: missing ref and plugin path/,
      );
    });

    it("trims whitespace from tree URL input", async () => {
      const result = await parseSource(
        "  https://github.com/owner/repo/tree/main/plugin-name  ",
      );
      expect(result).toEqual({
        type: "direct-path",
        owner: "owner",
        repo: "repo",
        ref: "main",
        targetPlugin: "plugin-name",
        manifestKey: "owner/repo/plugin-name",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });
  });

  describe("local path sources", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `agntc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("parses absolute path starting with /", async () => {
      const result = await parseSource(testDir);
      expect(result).toEqual({
        type: "local-path",
        resolvedPath: testDir,
        ref: null,
        manifestKey: testDir,
      });
    });

    it("resolves ./ relative path to absolute", async () => {
      // Create a subdir in cwd to test ./ prefix
      const cwd = process.cwd();
      const subName = `agntc-dotslash-test-${Date.now()}`;
      const subDir = join(cwd, subName);
      mkdirSync(subDir, { recursive: true });
      try {
        const result = await parseSource(`./${subName}`);
        expect(result.type).toBe("local-path");
        if (result.type === "local-path") {
          expect(result.resolvedPath).toBe(subDir);
          expect(result.manifestKey).toBe(subDir);
        }
      } finally {
        rmSync(subDir, { recursive: true, force: true });
      }
    });

    it("resolves ../ relative paths to absolute", async () => {
      // path.resolve normalizes ../ segments
      const subDir = join(testDir, "sub");
      mkdirSync(subDir);
      const relativePath = `${testDir}/sub/..`;
      const result = await parseSource(relativePath);
      expect(result.type).toBe("local-path");
      if (result.type === "local-path") {
        expect(result.resolvedPath).toBe(testDir);
        expect(result.manifestKey).toBe(testDir);
      }
    });

    it("expands tilde to home directory", async () => {
      // ~ alone should resolve to the home directory
      const home = homedir();
      const result = await parseSource("~");
      expect(result.type).toBe("local-path");
      if (result.type === "local-path") {
        expect(result.resolvedPath).toBe(home);
        expect(result.manifestKey).toBe(home);
      }
    });

    it("has ref as null for local paths", async () => {
      const result = await parseSource(testDir);
      expect(result.ref).toBeNull();
    });

    it("uses resolved absolute path as manifestKey", async () => {
      const result = await parseSource(testDir);
      expect(result.manifestKey).toBe(testDir);
    });

    it("throws for non-existent path", async () => {
      const fakePath = join(testDir, "does-not-exist");
      await expect(parseSource(fakePath)).rejects.toThrow(
        `Path ${fakePath} does not exist or is not a directory`,
      );
    });

    it("throws for path that is a file, not a directory", async () => {
      const filePath = join(testDir, "somefile.txt");
      writeFileSync(filePath, "content");
      await expect(parseSource(filePath)).rejects.toThrow(
        `Path ${filePath} does not exist or is not a directory`,
      );
    });

    it("detects ./ prefix as local path", async () => {
      const cwd = process.cwd();
      const subName = `agntc-dotprefix-test-${Date.now()}`;
      const subDir = join(cwd, subName);
      mkdirSync(subDir, { recursive: true });
      try {
        const result = await parseSource(`./${subName}`);
        expect(result.type).toBe("local-path");
      } finally {
        rmSync(subDir, { recursive: true, force: true });
      }
    });

    it("detects ../ prefix as local path", async () => {
      // ../agntc should resolve to parent dir / agntc = cwd
      // This tests that ../ prefix triggers local path detection
      const cwd = process.cwd();
      const cwdName = cwd.split("/").pop()!;
      const result = await parseSource(`../${cwdName}`);
      expect(result.type).toBe("local-path");
      if (result.type === "local-path") {
        expect(result.resolvedPath).toBe(cwd);
      }
    });

    it("detects / prefix as local path", async () => {
      const result = await parseSource(testDir);
      expect(result.type).toBe("local-path");
    });

    it("detects ~ prefix as local path", async () => {
      const home = homedir();
      const result = await parseSource("~");
      expect(result.type).toBe("local-path");
      if (result.type === "local-path") {
        expect(result.resolvedPath).toBe(home);
      }
    });

    it("trims whitespace before detecting local path", async () => {
      const result = await parseSource(`  ${testDir}  `);
      expect(result.type).toBe("local-path");
      if (result.type === "local-path") {
        expect(result.resolvedPath).toBe(testDir);
      }
    });
  });
});

describe("buildParsedSourceFromKey", () => {
  it("returns github-shorthand for standalone key without cloneUrl", () => {
    const result = buildParsedSourceFromKey("owner/repo", "v1.0", null);
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v1.0",
      manifestKey: "owner/repo",
    });
  });

  it("returns github-shorthand with null ref", () => {
    const result = buildParsedSourceFromKey("owner/repo", null, null);
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: null,
      manifestKey: "owner/repo",
    });
  });

  it("returns https-url when cloneUrl is provided", () => {
    const result = buildParsedSourceFromKey(
      "owner/repo",
      "main",
      "https://github.com/owner/repo.git",
    );
    expect(result).toEqual({
      type: "https-url",
      owner: "owner",
      repo: "repo",
      ref: "main",
      manifestKey: "owner/repo",
      cloneUrl: "https://github.com/owner/repo.git",
    });
  });

  it("extracts owner/repo from collection key (owner/repo/plugin)", () => {
    const result = buildParsedSourceFromKey("owner/repo/plugin", "v2.0", null);
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v2.0",
      manifestKey: "owner/repo",
    });
  });

  it("extracts owner/repo from collection key with cloneUrl", () => {
    const result = buildParsedSourceFromKey(
      "owner/repo/plugin",
      "v2.0",
      "https://gitlab.com/owner/repo.git",
    );
    expect(result).toEqual({
      type: "https-url",
      owner: "owner",
      repo: "repo",
      ref: "v2.0",
      manifestKey: "owner/repo",
      cloneUrl: "https://gitlab.com/owner/repo.git",
    });
  });
});

describe("getSourceDirFromKey", () => {
  it("returns tempDir for standalone key (owner/repo)", () => {
    const result = getSourceDirFromKey("/tmp/clone-abc", "owner/repo");
    expect(result).toBe("/tmp/clone-abc");
  });

  it("returns tempDir joined with subpath for collection key (owner/repo/plugin)", () => {
    const result = getSourceDirFromKey("/tmp/clone-abc", "owner/repo/plugin");
    expect(result).toBe(join("/tmp/clone-abc", "plugin"));
  });

  it("returns tempDir joined with nested subpath for deep collection key", () => {
    const result = getSourceDirFromKey("/tmp/clone-abc", "owner/repo/nested/plugin");
    expect(result).toBe(join("/tmp/clone-abc", "nested/plugin"));
  });
});
