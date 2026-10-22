import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { prisma } from "@gitcrook/db";
import { hashSitePassword } from "../../packages/auth/src/visitorAccess";
import { makeSite } from "../support/factory";
import { BASE_URL, SIDEBAR_SCROLL, addPages, launchBrowser, makeAdmin, markShell, newContext, shellState } from "./support";

let browser: Browser;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
const stamp = Date.now().toString(36);
const TOKEN = `share${stamp}AbCdEf0123456789`;

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point at the database the app under test uses (see tests/e2e/README.md).");
  browser = await launchBrowser();
  admin = await makeAdmin();
});

afterAll(async () => {
  await browser?.close();
  if (admin) {
    await prisma.organization.delete({ where: { id: admin.org.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.user.id } }).catch(() => undefined);
  }
});

const arrived = (page: import("playwright-core").Page, expected: string) => page.waitForFunction((p) => location.pathname === p, expected, { timeout: 10_000 });

describe("share links (B3)", () => {
  it("trade the token for a cookie once, then work for every page, image, search and feed request", async () => {
    const slug = `e2e-share-${stamp}`;
    const built = await makeSite({ organizationId: admin.org.id, slug, audienceMode: "PRIVATE" });
    await addPages(built.variant.id, built.site.id, ["alpha", "beta", "gamma"]);
    await prisma.page.updateMany({ where: { siteId: built.site.id }, data: { contentText: "findable words" } });
    const link = await prisma.shareLink.create({ data: { siteId: built.site.id, token: TOKEN, createdById: admin.user.id } });

    // Anonymous, without the link: the private screen, and nothing about the site's structure.
    const stranger = await newContext(browser);
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`${BASE_URL}/${slug}/alpha`, { waitUntil: "networkidle" });
    expect(await strangerPage.textContent("body")).toContain("This site is private");
    expect(await strangerPage.locator("nav[data-placement='sidebar']").count()).toBe(0);
    expect(await strangerPage.content()).not.toContain("beta");
    await stranger.close();

    // With the link: the token disappears from the URL, the page loads, and the cookie is HttpOnly.
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/${slug}/alpha?token=${TOKEN}`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).search).toBe("");
    expect(new URL(page.url()).pathname).toBe(`/${slug}/alpha`);
    expect(await page.textContent("h1")).toContain("alpha");
    const cookie = (await ctx.cookies()).find((c) => c.name === "gc-share");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value).toContain(TOKEN);

    // The second page used to be private (the token only rode on the first request).
    await markShell(page);
    await page.click(`${SIDEBAR_SCROLL} a:has-text("beta")`);
    await arrived(page, `/${slug}/beta`);
    expect(await page.textContent("h1")).toContain("beta");
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true });

    // Search, the feed and the Markdown route all honour the cookie too.
    expect(await page.evaluate(async (id) => (await (await fetch(`/api/sites/${id}/search?q=findable`)).json()).results.length, built.site.id)).toBeGreaterThan(0);
    expect(await page.evaluate(async (id) => (await fetch(`/api/sites/${id}/updates.rss`)).status, built.site.id)).toBe(200);
    const alphaId = (await prisma.page.findFirstOrThrow({ where: { siteId: built.site.id, slug: "alpha" } })).id;
    expect(await page.evaluate(async (id) => (await fetch(`/api/pages/${id}/markdown`)).status, alphaId)).toBe(200);
    await ctx.close();

    // Revoking the link takes effect on the next request, cookie or not.
    await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
    const after = await newContext(browser);
    await after.addCookies([{ name: "gc-share", value: TOKEN, url: BASE_URL }]);
    const afterPage = await after.newPage();
    await afterPage.goto(`${BASE_URL}/${slug}/alpha`, { waitUntil: "networkidle" });
    expect(await afterPage.textContent("body")).toContain("This site is private");
    expect(await afterPage.evaluate(async (id) => (await fetch(`/api/pages/${id}/markdown`)).status, alphaId)).toBe(404);
    await after.close();
  });

  it("a made-up token in the URL grants nothing and still gets redirected to the clean URL", async () => {
    const slug = `e2e-share-bad-${stamp}`;
    const built = await makeSite({ organizationId: admin.org.id, slug, audienceMode: "PRIVATE" });
    await addPages(built.variant.id, built.site.id, ["alpha"]);
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/${slug}/alpha?token=notarealtoken0123456789`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).search).toBe("");
    expect(await page.textContent("body")).toContain("This site is private");
    await ctx.close();
  });

  it("other query parameters survive the exchange", async () => {
    const slug = `e2e-share-q-${stamp}`;
    const built = await makeSite({ organizationId: admin.org.id, slug });
    await addPages(built.variant.id, built.site.id, ["alpha"]);
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/${slug}/alpha?token=${TOKEN}&ref=newsletter`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).search).toBe("?ref=newsletter");
    await ctx.close();
  });
});

describe("password sites", () => {
  it("show a themed gate, take the visitor back to their page, and lock again when the password changes", async () => {
    const slug = `e2e-pw-${stamp}`;
    const built = await makeSite({ organizationId: admin.org.id, slug, audienceMode: "PASSWORD" });
    await addPages(built.variant.id, built.site.id, ["alpha", "beta"]);
    await prisma.sitePassword.create({ data: { siteId: built.site.id, passwordHash: await hashSitePassword("open sesame") } });

    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/${slug}/beta`, { waitUntil: "networkidle" });
    expect(await page.textContent("body")).toContain("password-protected");
    expect(await page.locator("nav[data-placement='sidebar']").count()).toBe(0); // no structure before the password
    // The gate is drawn inside the site's themed frame (it used to be bare, with default colours).
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("[data-site-root]")!).getPropertyValue("--site-primary").trim())).not.toBe("");
    expect(await page.locator("[data-site-root]").count()).toBe(1);

    await page.fill('input[name="password"]', "wrong");
    await page.click('button[type="submit"]');
    await page.waitForSelector("text=Incorrect password");

    await page.fill('input[name="password"]', "open sesame");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector("nav[data-placement='sidebar']") !== null, null, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(`/${slug}/beta`);
    expect(await page.textContent("h1")).toContain("beta");

    await markShell(page);
    await page.click(`${SIDEBAR_SCROLL} a:has-text("alpha")`);
    await arrived(page, `/${slug}/alpha`);
    expect((await shellState(page)).noReload).toBe(true);

    // Changing the password signs everyone out: the next page they open shows the gate again.
    await prisma.sitePassword.update({ where: { siteId: built.site.id }, data: { version: { increment: 1 } } });
    await page.click(`${SIDEBAR_SCROLL} a:has-text("beta")`);
    await page.waitForSelector("text=password-protected", { timeout: 10_000 });
    await ctx.close();
  });
});

describe("the Markdown route", () => {
  it("serves a public page, and refuses a private one to a stranger", async () => {
    const pub = await makeSite({ organizationId: admin.org.id, slug: `e2e-md-pub-${stamp}` });
    await addPages(pub.variant.id, pub.site.id, ["alpha"]);
    const priv = await makeSite({ organizationId: admin.org.id, slug: `e2e-md-priv-${stamp}`, audienceMode: "PRIVATE" });
    await addPages(priv.variant.id, priv.site.id, ["alpha"]);
    const pubId = (await prisma.page.findFirstOrThrow({ where: { siteId: pub.site.id } })).id;
    const privId = (await prisma.page.findFirstOrThrow({ where: { siteId: priv.site.id } })).id;

    const ok = await fetch(`${BASE_URL}/api/pages/${pubId}/markdown`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/markdown");
    const denied = await fetch(`${BASE_URL}/api/pages/${privId}/markdown`);
    expect(denied.status).toBe(404);
  });
});
