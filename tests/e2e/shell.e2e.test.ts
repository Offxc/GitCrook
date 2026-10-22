import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { prisma } from "@gitcrook/db";
import { makePage, makeSite } from "../support/factory";
import {
  BASE_URL,
  CUSTOM_HOST,
  HEADER,
  SIDEBAR,
  SIDEBAR_SCROLL,
  addPages,
  launchBrowser,
  makeAdmin,
  makeLongSite,
  markShell,
  newContext,
  shellState,
  sidebarOffset,
  type StructureSpec,
} from "./support";

let browser: Browser;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
let long: Awaited<ReturnType<typeof makeLongSite>>;
const SLUG = {
  long: `e2e-long-${Date.now().toString(36)}`,
  multi: `e2e-multi-${Date.now().toString(36)}`,
  versions: `e2e-versions-${Date.now().toString(36)}`,
  domain: `e2e-domain-${Date.now().toString(36)}`,
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point at the database the app under test uses (see tests/e2e/README.md).");
  browser = await launchBrowser();
  admin = await makeAdmin();
  long = await makeLongSite(admin.org.id, SLUG.long);
});

afterAll(async () => {
  await browser?.close();
  // Everything the tests made hangs off the organisation or the user.
  if (admin) {
    await prisma.organization.delete({ where: { id: admin.org.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: admin.user.id } }).catch(() => undefined);
  }
});

const url = (...segments: string[]) => `${BASE_URL}/${segments.join("/")}`;

async function open(path: string, opts: { sessionToken?: string } = {}) {
  const ctx = await newContext(browser, opts);
  const page = await ctx.newPage();
  await page.goto(url(path), { waitUntil: "networkidle" });
  return { ctx, page };
}

/** Waits until the URL path equals `expected` (a soft navigation commits asynchronously). */
const arrived = (page: Page, expected: string) => page.waitForFunction((p) => location.pathname === p, expected, { timeout: 10_000 });

const sidebarLink = (page: Page, text: string) => page.locator(`${SIDEBAR_SCROLL} a`, { hasText: new RegExp(`^\\s*${text}\\s*$`) }).first();

describe("the shell stays mounted while the reader moves around", () => {
  it("survives 20 navigations: the same nodes, no document reload, and the sidebar does not move", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[2]!.path.join("/")}`);
    await markShell(page);

    // Scroll the sidebar somewhere that isn't the top, then click links that are already visible: the offset must not change.
    await page.$eval(SIDEBAR_SCROLL, (el) => (el.scrollTop = 150));
    await page.waitForTimeout(300);
    const offsets: number[] = [];
    let clicks = 0;
    while (clicks < 20) {
      const candidates = await page.$$eval(`${SIDEBAR_SCROLL} a`, (links) => {
        const box = (document.querySelector('nav[data-placement="sidebar"] div.overflow-y-auto') as HTMLElement).getBoundingClientRect();
        return links
          // checkVisibility(): a link inside a closed <details> still reports a rectangle.
          .filter((a) => a.checkVisibility())
          .map((a) => ({ text: a.textContent?.trim() ?? "", top: a.getBoundingClientRect().top, bottom: a.getBoundingClientRect().bottom, current: a.getAttribute("aria-current") === "page" }))
          .filter((l) => !l.current && l.top > box.top + 40 && l.bottom < box.bottom - 40);
      });
      expect(candidates.length).toBeGreaterThan(0);
      const target = candidates[clicks % candidates.length]!;
      const before = await sidebarOffset(page);
      await sidebarLink(page, target.text).click();
      await page.waitForFunction((t) => document.querySelector('nav[data-placement="sidebar"] [aria-current="page"]')?.textContent?.trim() === t, target.text, { timeout: 10_000 });
      await page.waitForTimeout(150);
      offsets.push((await sidebarOffset(page)) - before);
      clicks++;
    }

    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, scroll: true, header: true, root: true });
    expect(offsets.every((delta) => Math.abs(delta) <= 2)).toBe(true);
    await ctx.close();
  });

  it("previous/next keep the shell and move the highlight", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    await markShell(page);
    await page.click('nav[aria-label="Pagination"] a:has-text("Next")');
    await arrived(page, `/${SLUG.long}/${long.pages[1]!.path.join("/")}`);
    expect(await page.locator(`${SIDEBAR} [aria-current="page"]`).textContent()).toContain(long.pages[1]!.title);
    expect((await shellState(page)).sidebar).toBe(true);
    await page.click('nav[aria-label="Pagination"] a:has-text("Previous")');
    await arrived(page, `/${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, header: true });
    await ctx.close();
  });

  it("the first page of a group does not offer its own group as 'Previous' (A4)", async () => {
    const first = long.firstOfGroup[1]!; // the first page of group 2
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[first]!.path.join("/")}`);
    const href = await page.getAttribute('nav[aria-label="Pagination"] a:has-text("Previous")', "href");
    expect(href).toBe(`/${SLUG.long}/${long.pages[first - 1]!.path.join("/")}`); // the last page of group 1
    await ctx.close();
  });

  it("back and forward keep the shell and the highlight in step with the URL", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    await markShell(page);
    await sidebarLink(page, long.pages[3]!.title).click();
    await arrived(page, `/${SLUG.long}/${long.pages[3]!.path.join("/")}`);
    await page.goBack();
    await arrived(page, `/${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    expect(await page.locator(`${SIDEBAR} [aria-current="page"]`).textContent()).toContain(long.pages[0]!.title);
    await page.goForward();
    await arrived(page, `/${SLUG.long}/${long.pages[3]!.path.join("/")}`);
    expect(await page.locator(`${SIDEBAR} [aria-current="page"]`).textContent()).toContain(long.pages[3]!.title);
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, scroll: true });
    await ctx.close();
  });

  it("groups the reader opened stay open when they navigate elsewhere", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    const toggles = await page.$$(`${SIDEBAR_SCROLL} details:not([open]) > summary span.ml-auto`);
    for (const t of toggles) await t.click();
    const openBefore = await page.$$eval(`${SIDEBAR_SCROLL} details[open]`, (d) => d.length);
    expect(openBefore).toBeGreaterThan(0);
    await page.click('nav[aria-label="Pagination"] a:has-text("Next")');
    await arrived(page, `/${SLUG.long}/${long.pages[1]!.path.join("/")}`);
    expect(await page.$$eval(`${SIDEBAR_SCROLL} details[open]`, (d) => d.length)).toBe(openBefore);
    await ctx.close();
  });

  it("scrolls the sidebar to the new page only when it is out of view", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[0]!.path.join("/")}`);
    // Jump far down the book without touching the sidebar (as a link in the page body or a search result
    // would): the new page is out of view in the sidebar, and it must be brought into view.
    const far = `/${SLUG.long}/${long.pages[long.pages.length - 3]!.path.join("/")}`;
    await markShell(page);
    await page.evaluate((to) => (window as unknown as { next: { router: { push(href: string): void } } }).next.router.push(to), far);
    await arrived(page, far);
    expect((await shellState(page)).noReload).toBe(true);
    await page.waitForTimeout(400);
    const visible = await page.$eval(SIDEBAR_SCROLL, (el) => {
      const a = el.querySelector('[aria-current="page"]') as HTMLElement | null;
      if (!a) return false;
      const r = a.getBoundingClientRect();
      const c = el.getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom;
    });
    expect(visible).toBe(true);
    await ctx.close();
  });

  it("a hard reload puts the sidebar back where the reader left it", async () => {
    // Somewhere in the middle, so the active item sits mid-list; then nudge the list a little without
    // moving the active item out of view (a reload deliberately reveals an active item that is).
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[30]!.path.join("/")}`);
    await page.$eval(SIDEBAR_SCROLL, (el) => (el.scrollTop += 60));
    await page.waitForTimeout(400);
    const saved = await sidebarOffset(page);
    expect(saved).toBeGreaterThan(60);
    await page.reload({ waitUntil: "networkidle" });
    expect(Math.abs((await sidebarOffset(page)) - saved)).toBeLessThanOrEqual(2);
    await ctx.close();
  });

  it("an unknown page is a real 404 with the site's shell around it", async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const response = await page.goto(url(SLUG.long, "no-such-page"), { waitUntil: "networkidle" });
    expect(response?.status()).toBe(404);
    expect(await page.locator(SIDEBAR).count()).toBe(1);
    expect(await page.textContent("main")).toContain("doesn't exist");
    await ctx.close();
  });
});

describe("sections and versions", () => {
  it("switching section keeps the shell and swaps the tree", async () => {
    const structure: StructureSpec = [
      { slug: "guides", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
      { slug: "api", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
    ];
    const built = await makeSite({ organizationId: admin.org.id, slug: SLUG.multi, structure });
    await addPages(built.variants[0]!.id, built.site.id, ["welcome", "install"]);
    await addPages(built.variants[1]!.id, built.site.id, ["reference", "errors"]);

    const { ctx, page } = await open(`${SLUG.multi}/guides/welcome`);
    await markShell(page);
    expect(await page.locator(`${SIDEBAR_SCROLL} a`).allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("welcome")]));

    await page.click('nav[aria-label="Sections"] a:has-text("Section 1")');
    await arrived(page, `/${SLUG.multi}/api`);
    await page.waitForFunction(() => document.querySelector('nav[data-placement="sidebar"]')?.textContent?.includes("reference"), null, { timeout: 10_000 });
    const links = await page.locator(`${SIDEBAR_SCROLL} a`).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(links).toEqual([`/${SLUG.multi}/api/reference`, `/${SLUG.multi}/api/errors`]); // every link carries the section (A3)
    expect(await page.locator('nav[aria-label="Sections"] [aria-current="page"]').textContent()).toContain("Section 1");
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, header: true, root: true });
    await ctx.close();
  });

  it("switching version keeps the shell, stays on the equivalent page, and links stay inside the version", async () => {
    const structure: StructureSpec = [{ slug: "docs", spaces: [{ slug: "main", variants: [{ slug: "v2", isDefault: true }, { slug: "v1" }] }] }];
    const built = await makeSite({ organizationId: admin.org.id, slug: SLUG.versions, structure });
    const [v2, v1] = built.variants as [(typeof built.variants)[number], (typeof built.variants)[number]];
    await addPages(v2.id, built.site.id, ["intro", "only-in-v2"]);
    await addPages(v1.id, built.site.id, ["intro", "legacy"]);

    const { ctx, page } = await open(`${SLUG.versions}/intro`);
    await markShell(page);
    await page.click(`${HEADER} details[data-placement="variant-switcher"] summary`);
    await page.click(`${HEADER} details[data-placement="variant-switcher"] a:has-text("Variant 1")`);
    await arrived(page, `/${SLUG.versions}/~v/v1/intro`);
    const links = await page.locator(`${SIDEBAR_SCROLL} a`).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(links).toEqual([`/${SLUG.versions}/~v/v1/intro`, `/${SLUG.versions}/~v/v1/legacy`]); // no silent hop back to the default (A3)
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, header: true });

    // A page that doesn't exist in the other version falls back to that version's first page.
    await page.click(`${SIDEBAR_SCROLL} a:has-text("legacy")`);
    await arrived(page, `/${SLUG.versions}/~v/v1/legacy`);
    await page.click(`${HEADER} details[data-placement="variant-switcher"] summary`);
    await page.click(`${HEADER} details[data-placement="variant-switcher"] a:has-text("Variant 0")`);
    await arrived(page, `/${SLUG.versions}`);
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true });
    await ctx.close();
  });
});

describe("editing", () => {
  it("edit mode switches on and off without rebuilding the shell, and survives navigation", async () => {
    const { ctx, page } = await open(`${SLUG.long}/${long.pages[0]!.path.join("/")}`, { sessionToken: admin.sessionToken });
    await markShell(page);
    await page.click("button[aria-pressed]"); // Edit
    await page.waitForSelector(`${SIDEBAR_SCROLL} button[aria-label^="Reorder"]`, { timeout: 15_000 });
    expect((await shellState(page)).sidebar).toBe(true);

    await page.$eval(SIDEBAR_SCROLL, (el) => (el.scrollTop = 300));
    await page.waitForTimeout(300);
    const visible = await page.$$eval(`${SIDEBAR_SCROLL} a`, (links) => {
      const box = (document.querySelector('nav[data-placement="sidebar"] div.overflow-y-auto') as HTMLElement).getBoundingClientRect();
      return links
        .filter((a) => a.checkVisibility())
        .map((a) => ({ text: a.textContent?.trim() ?? "", top: a.getBoundingClientRect().top, bottom: a.getBoundingClientRect().bottom }))
        .filter((l) => l.top > box.top + 40 && l.bottom < box.bottom - 40);
    });
    const target = visible[2]!;
    await sidebarLink(page, target.text).click();
    await page.waitForFunction((t) => !!Array.from(document.querySelectorAll('nav[data-placement="sidebar"] a')).find((a) => a.textContent?.trim() === t && a.getAttribute("aria-current") === "page"), target.text, { timeout: 10_000 });
    await page.waitForTimeout(500);
    expect(await page.locator(`${SIDEBAR_SCROLL} button[aria-label^="Reorder"]`).count()).toBeGreaterThan(0);
    expect(Math.abs((await sidebarOffset(page)) - 300)).toBeLessThanOrEqual(2);

    await page.click("button[aria-pressed]"); // Done editing
    await page.waitForSelector(`${SIDEBAR_SCROLL} button[aria-label^="Reorder"]`, { state: "detached", timeout: 15_000 });
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, header: true, root: true });
    await ctx.close();
  });

  it("only people who can edit are sent the page JSON, and no one is sent the Markdown", async () => {
    const marker = `payload-marker-${Date.now()}`;
    await makePage({
      variantId: long.variant.id,
      siteId: long.site.id,
      slug: "payload-check",
      title: "Payload check",
      content: [{ id: "pm", type: "paragraph", content: [{ type: "text", text: marker, styles: {} }] }],
      contentText: marker,
      order: 999,
    });
    const anon = await fetch(url(SLUG.long, "payload-check"));
    const html = await anon.text();
    // Once in the markup and once in the framework payload that rebuilds it; a third copy would be the editor's JSON.
    expect(html.split(marker).length - 1).toBeLessThanOrEqual(2);
    // The editor's props travel inside an escaped string in the framework payload; for an anonymous reader the content is null.
    expect(html).toMatch(/initialContent\\?":null/);
  });
});

describe("custom domains", () => {
  it("the shell persists on a custom domain and its links carry no site prefix", async () => {
    const built = await makeLongSite(admin.org.id, SLUG.domain, 2, 4);
    await prisma.customDomain.create({ data: { siteId: built.site.id, hostname: CUSTOM_HOST, status: "ACTIVE", verificationToken: "t", verifiedAt: new Date() } });

    const port = new URL(BASE_URL).port;
    const origin = `http://${CUSTOM_HOST}${port ? `:${port}` : ""}`;
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${origin}/${built.pages[0]!.path.join("/")}`, { waitUntil: "networkidle" });
    await markShell(page);
    const hrefs = await page.locator(`${SIDEBAR_SCROLL} a`).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs[0]).toBe(`/${built.pages[0]!.path.join("/")}`);

    await sidebarLink(page, built.pages[3]!.title).click();
    await arrived(page, `/${built.pages[3]!.path.join("/")}`);
    expect(await page.locator(`${SIDEBAR} [aria-current="page"]`).textContent()).toContain(built.pages[3]!.title);
    expect(await shellState(page)).toMatchObject({ noReload: true, sidebar: true, header: true });

    // The platform API answers on the custom host too (images, search, feeds used to 404 here).
    const search = await page.evaluate(async (siteId) => (await fetch(`/api/sites/${siteId}/search?q=page`)).status, built.site.id);
    expect(search).toBe(200);
    await ctx.close();
  });
});
