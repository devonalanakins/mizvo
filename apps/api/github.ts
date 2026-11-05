import { assert, text, HttpError } from "../../packages/authz/security.ts";
export class GitHub {
  allowed: string[];
  private credential?: string;
  private transport: typeof fetch;
  constructor(
    allowed: string[],
    credential?: string,
    transport: typeof fetch = fetch,
  ) {
    this.allowed = allowed;
    this.credential = credential;
    this.transport = transport;
  }
  allow(repository: string) {
    assert(
      this.allowed.includes(repository),
      403,
      "This repository has not been authorized by the server administrator.",
    );
  }
  async read(repository: string, resource: string) {
    this.allow(repository);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.transport(
        `https://api.github.com/repos/${repository}/${resource}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Mizvo-ReadOnly-Workbench",
            ...(this.credential
              ? { Authorization: `Bearer ${this.credential}` }
              : {}),
          },
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new HttpError(
          response.status === 404 ? 404 : 502,
          response.status === 404
            ? "Repository resource unavailable."
            : "GitHub could not return evidence. Retry later.",
        );
      assert(
        Number(response.headers.get("content-length") ?? 0) < 2_000_000,
        502,
        "Source response is too large.",
      );
      const reader = response.body?.getReader();
      assert(reader, 502, "GitHub returned no response body.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new HttpError(502, "Source response is too large.");
        }
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      clearTimeout(timer);
    }
  }
  async evidence(repo: string) {
    const [branches, commits, pulls] = await Promise.all([
      this.read(repo, "branches?per_page=30"),
      this.read(repo, "commits?per_page=20"),
      this.read(repo, "pulls?state=open&per_page=30"),
    ]);
    return {
      repository: repo,
      fetched_at: new Date().toISOString(),
      branches: branches.map((x: any) => ({
        name: x.name,
        sha: x.commit.sha,
        protected: x.protected,
      })),
      commits: commits.map((x: any) => ({
        sha: x.sha,
        message: x.commit.message,
        url: x.html_url,
      })),
      pulls: pulls.map((x: any) => ({
        number: x.number,
        title: x.title,
        url: x.html_url,
        head: x.head.sha,
        draft: x.draft,
      })),
    };
  }
  async source(repo: string, path: string, ref: string) {
    text(ref, "Ref", 200);
    assert(
      !path.includes("..") && path.length < 800,
      400,
      "Invalid source path.",
    );
    return this.read(
      repo,
      `contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
    );
  }
}
