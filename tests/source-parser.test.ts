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
});
