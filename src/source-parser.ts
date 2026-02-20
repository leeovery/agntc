interface GitHubShorthandSource {
  type: "github-shorthand";
  owner: string;
  repo: string;
  ref: string | null;
  manifestKey: string;
}

interface HttpsUrlSource {
  type: "https-url";
  owner: string;
  repo: string;
  ref: string | null;
  manifestKey: string;
  cloneUrl: string;
}

export type ParsedSource = GitHubShorthandSource | HttpsUrlSource;

export function parseSource(raw: string): ParsedSource {
  const trimmed = raw.trim();

  if (trimmed === "") {
    throw new Error("source cannot be empty");
  }

  if (trimmed.startsWith("https://")) {
    return parseHttpsUrl(trimmed);
  }

  return parseGitHubShorthand(trimmed);
}

function parseHttpsUrl(input: string): HttpsUrlSource {
  const withoutProtocol = input.slice("https://".length);
  const { urlPart: rawUrlPart, ref } = extractRef(withoutProtocol);

  const urlPart = rawUrlPart.replace(/\/+$/, "");

  const slashIndex = urlPart.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `invalid HTTPS URL: no path segments in "https://${urlPart}"`,
    );
  }

  const host = urlPart.slice(0, slashIndex);
  const pathPart = urlPart.slice(slashIndex + 1).replace(/\.git$/, "");

  const segments = pathPart.split("/").filter((s) => s !== "");

  if (segments.length < 2) {
    throw new Error(
      `invalid HTTPS URL: expected owner/repo path, got "${pathPart}"`,
    );
  }

  const owner = segments[segments.length - 2]!;
  const repo = segments[segments.length - 1]!;
  const cloneUrl = `https://${host}/${owner}/${repo}.git`;

  return {
    type: "https-url",
    owner,
    repo,
    ref,
    manifestKey: `${owner}/${repo}`,
    cloneUrl,
  };
}

function extractRef(input: string): { urlPart: string; ref: string | null } {
  const atIndex = input.indexOf("@");

  if (atIndex === -1) {
    return { urlPart: input, ref: null };
  }

  const ref = input.slice(atIndex + 1);
  if (ref === "") {
    throw new Error("ref cannot be empty when @ is present");
  }

  return { urlPart: input.slice(0, atIndex), ref };
}

function parseGitHubShorthand(input: string): GitHubShorthandSource {
  const [pathPart, ...refParts] = input.split("@");
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
