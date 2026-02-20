import { describe, it, expect } from "vitest";
import { parseSource } from "../src/source-parser.js";

describe("parseSource", () => {
  it("parses owner/repo into structured source with null ref", () => {
    const result = parseSource("owner/repo");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: null,
      manifestKey: "owner/repo",
    });
  });

  it("parses owner/repo@ref with tag ref", () => {
    const result = parseSource("owner/repo@v2.0");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v2.0",
      manifestKey: "owner/repo",
    });
  });

  it("parses owner/repo@ref with branch name ref", () => {
    const result = parseSource("owner/repo@main");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "main",
      manifestKey: "owner/repo",
    });
  });

  it("returns manifestKey as owner/repo", () => {
    const result = parseSource("alice/my-skills@v1.0");
    expect(result.manifestKey).toBe("alice/my-skills");
  });

  it("trims whitespace from input", () => {
    const result = parseSource("  owner/repo  ");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: null,
      manifestKey: "owner/repo",
    });
  });

  it("throws for missing owner segment (bare repo name)", () => {
    expect(() => parseSource("repo")).toThrow(
      /must be in owner\/repo format/,
    );
  });

  it("throws for empty owner (leading slash)", () => {
    expect(() => parseSource("/repo")).toThrow(/owner cannot be empty/);
  });

  it("throws for empty repo (trailing slash)", () => {
    expect(() => parseSource("owner/")).toThrow(/repo cannot be empty/);
  });

  it("throws for empty ref after @ symbol", () => {
    expect(() => parseSource("owner/repo@")).toThrow(/ref cannot be empty/);
  });

  it("throws for extra slashes in path (three segments)", () => {
    expect(() => parseSource("a/b/c")).toThrow(
      /too many slashes/,
    );
  });

  it("throws for empty string input", () => {
    expect(() => parseSource("")).toThrow(/source cannot be empty/);
  });

  it("handles ref containing special characters (e.g., v2.0.0-beta.1)", () => {
    const result = parseSource("owner/repo@v2.0.0-beta.1");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "v2.0.0-beta.1",
      manifestKey: "owner/repo",
    });
  });

  it("splits on first @ only - ref can contain @ characters", () => {
    const result = parseSource("owner/repo@feat@special");
    expect(result).toEqual({
      type: "github-shorthand",
      owner: "owner",
      repo: "repo",
      ref: "feat@special",
      manifestKey: "owner/repo",
    });
  });

  describe("HTTPS URL sources", () => {
    it("parses GitHub HTTPS URL with owner/repo", () => {
      const result = parseSource("https://github.com/owner/repo");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses GitLab HTTPS URL", () => {
      const result = parseSource("https://gitlab.com/org/project");
      expect(result).toEqual({
        type: "https-url",
        owner: "org",
        repo: "project",
        ref: null,
        manifestKey: "org/project",
        cloneUrl: "https://gitlab.com/org/project.git",
      });
    });

    it("parses Bitbucket HTTPS URL", () => {
      const result = parseSource("https://bitbucket.org/team/tools");
      expect(result).toEqual({
        type: "https-url",
        owner: "team",
        repo: "tools",
        ref: null,
        manifestKey: "team/tools",
        cloneUrl: "https://bitbucket.org/team/tools.git",
      });
    });

    it("parses HTTPS URL with @ref suffix", () => {
      const result = parseSource("https://github.com/owner/repo@v1.0");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: "v1.0",
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("parses HTTPS URL with branch ref", () => {
      const result = parseSource("https://gitlab.com/org/project@main");
      expect(result).toEqual({
        type: "https-url",
        owner: "org",
        repo: "project",
        ref: "main",
        manifestKey: "org/project",
        cloneUrl: "https://gitlab.com/org/project.git",
      });
    });

    it("strips trailing slash from URL", () => {
      const result = parseSource("https://github.com/owner/repo/");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips .git suffix from repo in URL", () => {
      const result = parseSource("https://github.com/owner/repo.git");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips both trailing slash and .git suffix", () => {
      const result = parseSource("https://github.com/owner/repo.git/");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("strips .git suffix before extracting ref", () => {
      const result = parseSource("https://github.com/owner/repo.git@v2.0");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: "v2.0",
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("manifestKey is host-independent (owner/repo only)", () => {
      const github = parseSource("https://github.com/owner/repo");
      const gitlab = parseSource("https://gitlab.com/owner/repo");
      expect(github.manifestKey).toBe("owner/repo");
      expect(gitlab.manifestKey).toBe("owner/repo");
    });

    it("trims whitespace from HTTPS URL input", () => {
      const result = parseSource("  https://github.com/owner/repo  ");
      expect(result).toEqual({
        type: "https-url",
        owner: "owner",
        repo: "repo",
        ref: null,
        manifestKey: "owner/repo",
        cloneUrl: "https://github.com/owner/repo.git",
      });
    });

    it("throws for HTTPS URL with no path segments", () => {
      expect(() => parseSource("https://github.com")).toThrow();
    });

    it("throws for HTTPS URL with single path segment", () => {
      expect(() => parseSource("https://github.com/owner")).toThrow();
    });

    it("throws for HTTPS URL with empty ref after @", () => {
      expect(() => parseSource("https://github.com/owner/repo@")).toThrow(
        /ref cannot be empty/,
      );
    });

    it("supports self-hosted git hosts", () => {
      const result = parseSource("https://git.mycompany.com/team/project");
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

  describe("GitHub shorthand still works (no regression)", () => {
    it("simple owner/repo still returns github-shorthand type", () => {
      const result = parseSource("owner/repo");
      expect(result.type).toBe("github-shorthand");
    });

    it("owner/repo@ref still returns github-shorthand type", () => {
      const result = parseSource("owner/repo@v1.0");
      expect(result.type).toBe("github-shorthand");
    });
  });
});
