import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { prisma } from "@gitcrook/db";
import { makePage, makeSite } from "../support/factory";
import { BASE_URL, launchBrowser, makeAdmin, newContext } from "./support";

let browser: Browser;
let admin: Awaited<ReturnType<typeof makeAdmin>>;
const stamp = Date.now().toString(36);

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

describe("addresses from before a second section was added (A7)", () => {
  it("answer with a permanent redirect to the page's new address, and the page opens there", async () => {
    const slug = `e2e-legacy-${stamp}`;
    const built = await makeSite({
      organizationId: admin.org.id,
      slug,
      structure: [
        { slug: "guides", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
        { slug: "api", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] },
      ],
    });
    const [guides] = built.variants;
    const group = await makePage({ variantId: guides!.id, siteId: built.site.id, slug: "setup", title: "Setup", isGroup: true, order: 0 });
    await makePage({ variantId: guides!.id, siteId: built.site.id, slug: "install", title: "Install the thing", parentId: group.id, order: 0 });

    // What a link made when the site had one section looks like.
    const legacy = await fetch(`${BASE_URL}/${slug}/setup/install`, { redirect: "manual" });
    expect(legacy.status).toBe(308);
    expect(new URL(legacy.headers.get("location")!, BASE_URL).pathname).toBe(`/${slug}/guides/setup/install`);

    // The site's own root too.
    const root = await fetch(`${BASE_URL}/${slug}`, { redirect: "manual" });
    expect(root.status).toBe(308);
    expect(new URL(root.headers.get("location")!, BASE_URL).pathname).toBe(`/${slug}/guides`);

    // A browser follows it to the page.
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/${slug}/setup/install`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).toBe(`/${slug}/guides/setup/install`);
    expect(await page.textContent("body")).toContain("Install the thing");
    await ctx.close();

    // Something that never existed is still a 404, not a redirect.
    const missing = await fetch(`${BASE_URL}/${slug}/never-was`, { redirect: "manual" });
    expect(missing.status).toBe(404);
  });
});
