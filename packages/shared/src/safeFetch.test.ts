import { describe, expect, it, vi } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";
import { createGuardedLookup, createSafeFetch, isPrivateOrReservedIp, SsrfBlockedError } from "./safeFetch";

describe("isPrivateOrReservedIp", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1", // CGNAT
    "100.127.255.254",
    "127.0.0.1",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "0:0:0:0:0:0:0:1", // long form of ::1
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
    "2002:7f00:1::1", // 6to4 of 127.0.0.1
    "::ffff:127.0.0.1", // IPv4-mapped
    "::ffff:7f00:1", // IPv4-mapped, hex form
    "::ffff:a9fe:a9fe", // IPv4-mapped metadata address
    "fe80::1%eth0", // zone id
    "not-an-ip",
    "",
  ])("blocks %s", (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(true);
  });

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "100.63.255.255", // just below CGNAT
    "100.128.0.0", // just above CGNAT
    "172.15.255.255", // just below 172.16/12
    "172.32.0.0",
    "192.0.1.1",
    "198.17.255.255",
    "198.20.0.0",
    "93.184.216.34",
    "2606:4700:4700::1111",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8", // a public address wrapped in IPv4-mapped form is still public
  ])("allows %s", (address) => {
    expect(isPrivateOrReservedIp(address)).toBe(false);
  });
});

describe("createGuardedLookup", () => {
  const lookupWith = (addresses: { address: string; family: number }[]) =>
    new Promise<{ error: Error | null; address?: unknown; family?: number }>((resolve) => {
      createGuardedLookup(async () => addresses)("example.test", {}, (error, address, family) => resolve({ error, address, family }));
    });

  it("returns the validated address for a public name", async () => {
    const out = await lookupWith([{ address: "93.184.216.34", family: 4 }]);
    expect(out.error).toBeNull();
    expect(out.address).toBe("93.184.216.34");
    expect(out.family).toBe(4);
  });

  it("refuses a name that resolves to a private address", async () => {
    const out = await lookupWith([{ address: "10.0.0.5", family: 4 }]);
    expect(out.error).toBeInstanceOf(SsrfBlockedError);
  });

  it("refuses the whole name when only one of several answers is private", async () => {
    const out = await lookupWith([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect(out.error).toBeInstanceOf(SsrfBlockedError);
  });

  it("refuses a name with no answers", async () => {
    expect((await lookupWith([])).error).toBeInstanceOf(SsrfBlockedError);
  });

  it("passes resolver failures through", async () => {
    const error = await new Promise<Error | null>((resolve) => {
      createGuardedLookup(async () => {
        throw new Error("ENOTFOUND");
      })("nope.test", {}, (err) => resolve(err));
    });
    expect(error?.message).toBe("ENOTFOUND");
  });

  it("supports the `all` form node uses for happy-eyeballs", async () => {
    const out = await new Promise<unknown>((resolve) => {
      createGuardedLookup(async () => [{ address: "93.184.216.34", family: 4 }])("example.test", { all: true }, (_e, address) => resolve(address));
    });
    expect(out).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  // The point of the whole design: the address that is checked is the address that is connected to.
  // Run the real undici agent against a name that "resolves" to loopback and confirm it never connects.
  it("is enforced at connect time by a real agent", async () => {
    const agent = new Agent({ connect: { lookup: createGuardedLookup(async () => [{ address: "127.0.0.1", family: 4 }]) as never } });
    await expect(undiciFetch("https://rebind.test/", { dispatcher: agent })).rejects.toMatchObject({
      cause: expect.objectContaining({ name: "SsrfBlockedError" }),
    });
    await agent.close();
  });
});

describe("safeFetch rules", () => {
  const ok = () => new Response("hello", { status: 200 });
  const run = (impl: (url: string, init: Record<string, unknown>) => Promise<Response>) => createSafeFetch(impl as never);

  it.each([
    ["http://example.com/", /only https/],
    ["ftp://example.com/", /only https/],
    ["https://user:pw@example.com/", /credentials/],
    ["https://example.com:8443/", /port 8443/],
    ["https://127.0.0.1/", /private or reserved/],
    ["https://[::1]/", /private or reserved/],
    ["https://169.254.169.254/latest/meta-data/", /private or reserved/],
    ["https://[::ffff:7f00:1]/", /private or reserved/],
    ["not a url", /not a valid URL/],
  ])("rejects %s before any network call", async (url, reason) => {
    const impl = vi.fn(async () => ok());
    await expect(run(impl)(url)).rejects.toThrow(reason);
    expect(impl).not.toHaveBeenCalled();
  });

  it("honours the host allowlist", async () => {
    const impl = vi.fn(async () => ok());
    await expect(run(impl)("https://evil.example/", { allowedHosts: ["api.github.com"] })).rejects.toThrow(/allowlist/);
    expect(impl).not.toHaveBeenCalled();
    await expect(run(impl)("https://api.github.com/x", { allowedHosts: ["api.github.com"] })).resolves.toBeInstanceOf(Response);
  });

  it("allows an explicitly named extra port", async () => {
    const impl = vi.fn(async () => ok());
    await expect(run(impl)("https://example.com:8443/", { allowedPorts: [8443] })).resolves.toBeInstanceOf(Response);
  });

  it("follows redirects and re-checks every hop", async () => {
    const impl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/next" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }));
    await expect(run(impl)("https://example.com/start")).rejects.toThrow(/private or reserved/);
    expect(impl).toHaveBeenCalledTimes(2);
    expect(impl.mock.calls[1]![0]).toBe("https://example.com/next");
  });

  it("downgrades a POST to a GET on 302 but not on 307", async () => {
    const a = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/b" } }))
      .mockResolvedValueOnce(ok());
    await run(a)("https://example.com/a", { method: "POST", body: "x" });
    expect(a.mock.calls[1]![1]).toMatchObject({ method: "GET", body: undefined });

    const b = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/b" } }))
      .mockResolvedValueOnce(ok());
    await run(b)("https://example.com/a", { method: "POST", body: "x" });
    expect(b.mock.calls[1]![1]).toMatchObject({ method: "POST", body: "x" });
  });

  it("stops after too many redirects", async () => {
    const impl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "/again" } }));
    await expect(run(impl)("https://example.com/", { maxRedirects: 2 })).rejects.toThrow(/too many redirects/);
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it("rejects a redirect with no Location", async () => {
    const impl = vi.fn(async () => new Response(null, { status: 302 }));
    await expect(run(impl)("https://example.com/")).rejects.toThrow(/no Location/);
  });

  it("refuses a body whose Content-Length is over the cap", async () => {
    const impl = vi.fn(async () => new Response("x", { headers: { "content-length": "999" } }));
    await expect(run(impl)("https://example.com/", { maxBytes: 100 })).rejects.toThrow(/byte cap/);
  });

  it("enforces the cap while streaming when Content-Length is absent or a lie", async () => {
    const chunk = new Uint8Array(64);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const impl = vi.fn(async () => new Response(stream, { headers: { "content-length": "10" } }));
    const res = await run(impl)("https://example.com/", { maxBytes: 100 });
    await expect(res.arrayBuffer()).rejects.toThrow(/byte cap/);
  });

  it("delivers a body that fits", async () => {
    const res = await run(async () => new Response("hello world"))("https://example.com/", { maxBytes: 100 });
    expect(await res.text()).toBe("hello world");
  });

  it("passes the method, headers and a deadline signal to the network layer", async () => {
    const impl = vi.fn((...args: [string, Record<string, unknown>]) => Promise.resolve(args && ok()));
    await run(impl)("https://example.com/", { method: "POST", headers: { authorization: "Bearer t" }, body: "{}" });
    const init = impl.mock.calls[0]![1] as Record<string, unknown>;
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer t" }, body: "{}", redirect: "manual" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
