import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";

/** Addresses are checked at DNS resolution, then the HTTPS socket is pinned to
 * the selected numeric IP. TLS SNI and certificate validation use the original
 * hostname. No later DNS lookup, redirect, proxy, or credential forwarding occurs.
 */
const blockedV4 = new BlockList();
for (const [prefix, bits] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(prefix, bits, "ipv4");
}
const publicV6 = new BlockList();
publicV6.addSubnet("2000::", 3, "ipv6");
const blockedV6 = new BlockList();
for (const [prefix, bits] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  blockedV6.addSubnet(prefix, bits, "ipv6");
}

export function isPublicPreviewIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6)
    return (
      publicV6.check(address, "ipv6") &&
      !blockedV6.check(address, "ipv6")
    );
  return false;
}

export interface PreviewAddress {
  address: string;
  family: 4 | 6;
}
export type PreviewResolver = (hostname: string) => Promise<PreviewAddress[]>;

const systemResolver: PreviewResolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, order: "verbatim" });
  return answers.map(({ address, family }) => ({
    address,
    family: family as 4 | 6,
  }));
};

/** Fail closed if any answer is private, reserved or malformed, even if other
 * answers are public. Prevents mixed A/AAAA records bypassing validation.
 */
export async function resolvePublicPreview(
  hostname: string,
  resolver: PreviewResolver = systemResolver,
): Promise<PreviewAddress> {
  const answers = await resolver(hostname);
  if (
    !Array.isArray(answers) ||
    answers.length < 1 ||
    answers.length > 16 ||
    answers.some(
      (item) =>
        !item ||
        (item.family !== 4 && item.family !== 6) ||
        isIP(item.address) !== item.family ||
        !isPublicPreviewIp(item.address),
    )
  )
    throw new Error("Preview DNS destination is not a permitted public address.");
  return answers[0]!;
}

/** Pin the destination to a vetted numeric IP, while retaining the original
 * hostname solely for HTTPS Host, SNI and certificate verification.
 */
export function pinnedPreviewOptions(
  target: URL,
  destination: PreviewAddress,
): RequestOptions {
  return {
    protocol: "https:",
    hostname: destination.address,
    port: 443,
    servername: target.hostname,
    path: target.pathname,
    method: "HEAD",
    headers: {
      Host: target.hostname,
      Accept: "text/html",
      "Cache-Control": "no-store",
    },
    rejectUnauthorized: true,
    maxHeaderSize: 8192,
    agent: false,
    timeout: 5000,
  };
}

export interface PreviewHeadResult {
  status: number;
  reported_commit: string | null;
}
export type PreviewDial = (
  options: RequestOptions,
  signal: AbortSignal | null | undefined,
) => Promise<PreviewHeadResult>;

const realHead: PreviewDial = (options, signal) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      { ...options, signal: signal ?? undefined },
      (res) => {
        const raw = res.headers["x-mizvo-source-commit"];
        const reported_commit = typeof raw === "string" ? raw : null;
        const status = res.statusCode ?? 0;
        res.on("error", () => {
          // HEAD responses are discarded; do not expose transport details.
        });
        res.destroy();
        resolve({ status, reported_commit });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Preview timed out.")));
    req.end();
  });

export function createGuardedPreviewFetch(
  resolver: PreviewResolver = systemResolver,
  dial: PreviewDial = realHead,
): typeof fetch {
  return async (input, init) => {
    if (typeof input !== "string" && !(input instanceof URL))
      throw new Error("Unexpected preview input.");
    const target = new URL(String(input));
    if (
      target.protocol !== "https:" ||
      target.username ||
      target.password ||
      target.search ||
      target.hash ||
      target.port ||
      !target.hostname.includes(".") ||
      target.hostname.startsWith(".") ||
      target.hostname.endsWith(".") ||
      /\.(local|localhost|internal|test|invalid|example)$/i.test(
        target.hostname,
      ) ||
      isIP(target.hostname) !== 0 ||
      init?.method !== "HEAD" ||
      init?.redirect !== "manual" ||
      init?.credentials !== "omit"
    )
      throw new Error("Preview transport requires an exact read-only public HTTPS request.");

    const destination = await resolvePublicPreview(target.hostname, resolver);
    const result = await dial(pinnedPreviewOptions(target, destination), init.signal);
    const headers = new Headers();
    if (result.reported_commit)
      headers.set("X-Mizvo-Source-Commit", result.reported_commit);
    return new Response(null, { status: result.status, headers });
  };
}

export const guardedPreviewFetch = createGuardedPreviewFetch();
