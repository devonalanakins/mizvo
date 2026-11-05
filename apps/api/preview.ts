import { isIP } from "node:net";
import { assert, now } from "../../packages/authz/security.ts";

export interface PreviewObservation {
  preview_url: string;
  expected_commit: string;
  result: "reachable" | "http_error" | "redirect_denied" | "network_error";
  http_status: number | null;
  reported_commit: string | null;
  commit_matches: number | null;
  observed_at: string;
}

/**
 * Only installation-admin configured, exact public HTTPS URLs can be probed.
 * A response/header is an observation, NEVER proof of a deployment or its bytes.
 */
function safePreviewUrl(input: string): string {
  const parsed = new URL(input);
  assert(
    parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      !isIP(parsed.hostname) &&
      parsed.hostname.includes(".") &&
      !parsed.hostname.startsWith(".") &&
      !parsed.hostname.endsWith(".") &&
      !/\.(local|localhost|internal|test|invalid|example)$/i.test(
        parsed.hostname,
      ) &&
      parsed.port === "",
    400,
    "Preview checks require a configured public HTTPS URL without credentials or query tokens.",
  );
  return parsed.href;
}

export class PreviewProbe {
  private readonly allowlist: ReadonlySet<string>;
  private readonly transport: typeof fetch;
  constructor(urls: string[] = [], transport: typeof fetch = fetch) {
    this.allowlist = new Set(urls.map((u) => safePreviewUrl(u)));
    this.transport = transport;
  }

  allows(value: string): boolean {
    if (!value) return false;
    try {
      return this.allowlist.has(safePreviewUrl(value));
    } catch {
      return false;
    }
  }

  async observe(value: string, sha: string): Promise<PreviewObservation> {
    assert(
      this.allows(value),
      409,
      "This preview URL is not enabled for observation by the installation administrator.",
    );
    assert(/^[a-f0-9]{40}$/.test(sha), 400, "Invalid release commit.");
    const result: PreviewObservation = {
      preview_url: value,
      expected_commit: sha,
      result: "network_error",
      http_status: null,
      reported_commit: null,
      commit_matches: null,
      observed_at: now(),
    };
    try {
      const response = await this.transport(value, {
        method: "HEAD",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "text/html" },
        signal: AbortSignal.timeout(5000),
      });
      result.http_status = response.status;
      result.result =
        response.status >= 200 && response.status < 300
          ? "reachable"
          : response.status >= 300 && response.status < 400
            ? "redirect_denied"
            : "http_error";
      const reported = response.headers.get("X-Mizvo-Source-Commit");
      if (reported && /^[a-f0-9]{40}$/.test(reported)) {
        result.reported_commit = reported;
        result.commit_matches = Number(reported === sha);
      }
      await response.body?.cancel();
    } catch {
      // Avoid storing internal transport error messages, addresses or credentials.
    }
    result.observed_at = now();
    return result;
  }
}
