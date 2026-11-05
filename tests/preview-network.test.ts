import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createGuardedPreviewFetch,
  isPublicPreviewIp,
  pinnedPreviewOptions,
  resolvePublicPreview,
  type PreviewDial,
  type PreviewResolver,
} from "../apps/api/preview-network.ts";
import { PreviewProbe } from "../apps/api/preview.ts";

const url = "https://preview.example.org/ready";
const sha = "a".repeat(40);
const requestInit: RequestInit = {
  method: "HEAD",
  redirect: "manual",
  credentials: "omit",
  cache: "no-store",
};

test("preview destination policy rejects nonpublic, reserved and embedded private IP ranges", () => {
  for (const addr of [
    "0.0.0.0",
    "10.7.1.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.4.2",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.9",
    "203.0.113.3",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2001::2",
    "2002::1",
    "3fff::1",
    "example.org",
    "definitely-not-an-ip",
  ]) {
    assert.equal(isPublicPreviewIp(addr), false, addr);
  }
  for (const addr of [
    "1.1.1.1",
    "8.8.8.8",
    "9.9.9.9",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ]) {
    assert.equal(isPublicPreviewIp(addr), true, addr);
  }
});

test("preview refuses mixed DNS answers, family spoofing and empty or excessive answers", async () => {
  const cases = [
    [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
    [
      { address: "2606:4700:4700::1111", family: 6 },
      { address: "::ffff:169.254.169.254", family: 6 },
    ],
    [{ address: "8.8.8.8", family: 6 }],
    [{ address: "not-an-ip", family: 4 }],
    [],
    Array.from({ length: 17 }, () => ({ address: "8.8.8.8", family: 4 })),
  ];
  for (const answers of cases) {
    await assert.rejects(
      () =>
        resolvePublicPreview(
          "preview.example.org",
          async () => answers as never,
        ),
      /not a permitted public address/,
    );
  }
  let dialCount = 0;
  const neverDial: PreviewDial = async () => {
    dialCount++;
    throw new Error("Should never dial");
  };
  const unsafeResolver: PreviewResolver = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "169.254.169.254", family: 4 },
  ];
  const guarded = createGuardedPreviewFetch(unsafeResolver, neverDial);
  await assert.rejects(() => guarded(url, requestInit));
  assert.equal(dialCount, 0);
});

test("DNS cancellation is bounded and never opens a socket after abort", async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  let resolutions = 0;
  await assert.rejects(
    () =>
      resolvePublicPreview(
        "preview.example.org",
        async () => {
          resolutions++;
          return [{ address: "1.1.1.1", family: 4 }];
        },
        cancelled.signal,
      ),
    /cancelled/,
  );
  assert.equal(resolutions, 0);
  const controller = new AbortController();
  let dials = 0;
  const fetcher = createGuardedPreviewFetch(
    async () => new Promise<never>(() => {}),
    async () => {
      dials++;
      return { status: 200, reported_commit: null };
    },
  );
  const pending = fetcher(url, { ...requestInit, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(dials, 0);
  const shortly = createGuardedPreviewFetch(
    async () => new Promise<never>(() => {}),
    async () => {
      throw new Error("Never dial after DNS deadline");
    },
  );
  await assert.rejects(
    () => shortly(url, { ...requestInit, signal: AbortSignal.timeout(5) }),
    /cancelled/,
  );
});

test("preview pins the vetted IP and retains TLS hostname and certificate validation", async () => {
  let resolutions = 0;
  let dials = 0;
  const resolver: PreviewResolver = async (hostname) => {
    assert.equal(hostname, "preview.example.org");
    resolutions++;
    return [
      {
        address: resolutions === 1 ? "1.1.1.1" : "127.0.0.1",
        family: 4,
      },
    ];
  };
  const dial: PreviewDial = async (options, signal) => {
    dials++;
    assert.equal(options.protocol, "https:");
    assert.equal(options.hostname, "1.1.1.1");
    assert.equal(options.servername, "preview.example.org");
    assert.equal(options.port, 443);
    assert.equal(options.path, "/ready");
    assert.equal(options.method, "HEAD");
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    assert.equal(options.timeout, 5000);
    assert.equal(options.maxHeaderSize, 8192);
    const headers = options.headers as Record<string, string>;
    assert.equal(headers.Host, "preview.example.org");
    assert.equal(headers.Accept, "text/html");
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(signal, controller.signal);
    return { status: 200, reported_commit: sha };
  };
  const controller = new AbortController();
  const guarded = createGuardedPreviewFetch(resolver, dial);
  const response = await guarded(url, {
    ...requestInit,
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Mizvo-Source-Commit"), sha);
  assert.equal(dials, 1);
  assert.equal(
    resolutions,
    1,
    "Never perform a second DNS lookup after validating the IP",
  );
  const pinned = pinnedPreviewOptions(new URL(url), {
    address: "2606:4700:4700::1111",
    family: 6,
  });
  assert.equal(pinned.hostname, "2606:4700:4700::1111");
  assert.equal(pinned.servername, "preview.example.org");
});

test("preview refuses unauthorized methods and URL shapes before DNS lookup", async () => {
  let resolutions = 0;
  const resolver: PreviewResolver = async () => {
    resolutions++;
    return [{ address: "8.8.8.8", family: 4 }];
  };
  const guarded = createGuardedPreviewFetch(resolver, async () => {
    throw new Error("No request should be dialed.");
  });
  const invalid = [
    ["http://preview.example.org/ready", requestInit],
    ["https://127.0.0.1/ready", requestInit],
    ["https://preview.example.org:8443/ready", requestInit],
    ["https://preview.example.org/ready?token=x", requestInit],
    ["https://preview.example.org/ready#frag", requestInit],
    ["https://u:p@preview.example.org/ready", requestInit],
    [url, { ...requestInit, method: "GET" }],
    [url, { ...requestInit, redirect: "follow" }],
    [url, { ...requestInit, credentials: "include" }],
  ] as const;
  for (const [target, options] of invalid)
    await assert.rejects(() => guarded(target, options as RequestInit));
  assert.equal(resolutions, 0);
});

test("PreviewProbe maps blocked DNS rebinding to failed observation without any outbound dial", async () => {
  let dials = 0;
  const guarded = createGuardedPreviewFetch(
    async () => [{ address: "127.0.0.1", family: 4 }],
    async () => {
      dials++;
      return { status: 200, reported_commit: sha };
    },
  );
  const probe = new PreviewProbe([url], guarded);
  const observed = await probe.observe(url, sha);
  assert.equal(observed.result, "network_error");
  assert.equal(observed.http_status, null);
  assert.equal(observed.commit_matches, null);
  assert.equal(dials, 0);
  assert.equal(probe.allows(url), true);
});
