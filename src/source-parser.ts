interface GitHubShorthandSource {
  type: "github-shorthand";
  owner: string;
  repo: string;
  ref: string | null;
  manifestKey: string;
}

export type ParsedSource = GitHubShorthandSource;

export function parseSource(raw: string): ParsedSource {
  const trimmed = raw.trim();

  if (trimmed === "") {
    throw new Error("source cannot be empty");
  }

  const [pathPart, ...refParts] = trimmed.split("@");
  const ref = refParts.length > 0 ? refParts.join("@") : null;

  if (ref === "") {
    throw new Error("ref cannot be empty when @ is present");
  }

  const segments = pathPart!.split("/");

  if (segments.length === 1) {
    throw new Error(
      `source must be in owner/repo format, got "${pathPart}"`,
    );
  }

  if (segments.length > 2) {
    throw new Error(
      `too many slashes in source "${pathPart}" — expected owner/repo`,
    );
  }

  const [owner, repo] = segments as [string, string];

  if (owner === "") {
    throw new Error("owner cannot be empty");
  }

  if (repo === "") {
    throw new Error("repo cannot be empty");
  }

  return {
    type: "github-shorthand",
    owner,
    repo,
    ref,
    manifestKey: `${owner}/${repo}`,
  };
}
