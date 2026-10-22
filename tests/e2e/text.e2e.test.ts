import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { prisma } from "@gitcrook/db";
import { makePage, makeSite } from "../support/factory";
import { BASE_URL, CUSTOM_HOST, launchBrowser, makeAdmin, newContext } from "./support";

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

const paragraph = (text: string) => [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }];

async function textSite(slug: string, audienceMode: "PUBLIC" | "PRIVATE" = "PUBLIC") {
  const built = await makeSite({ organizationId: admin.org.id, slug, audienceMode });
  const v = built.variant.id;
  const s = built.site.id;
  const group = await makePage({ variantId: v, siteId: s, slug: "setup", title: "Setup", isGroup: true, order: 0 });
  await makePage({ variantId: v, siteId: s, slug: "install", title: "Install", parentId: group.id, order: 0, content: paragraph("Run the installer."), contentText: "Run the installer." });
  await makePage({ variantId: v, siteId: s, slug: "intro", title: "Intro", order: 1, content: paragraph("Welcome aboard."), contentText: "Welcome aboard." });
  await makePage({ variantId: v, siteId: s, slug: "draft-page", title: "Draft page", order: 2, isDraft: true });
  const hidden = await makePage({ variantId: v, siteId: s, slug: "unlisted", title: "Unlisted", order: 3, content: paragraph("Only by link."), contentText: "Only by link." });
  await prisma.page.update({ where: { id: hidden.id }, data: { isHidden: true, description: "Not in the menu." } });
  return built;
}

describe("the text forms of a site (GS-20)", () => {
  it("serves a page as Markdown, and lists the site for tools that read llms.txt", async () => {
    const slug = `e2e-text-${stamp}`;
    await textSite(slug);

    const page = await fetch(`${BASE_URL}/${slug}/setup/install.md`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/markdown");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await page.text()).toBe("# Install\n\nRun the installer.\n");

    // A page that is hidden from the menu is still a page; a draft is not.
    const hidden = await fetch(`${BASE_URL}/${slug}/unlisted.md`);
    expect(hidden.status).toBe(200);
    expect(await hidden.text()).toBe("# Unlisted\n\n> Not in the menu.\n\nOnly by link.\n");
    expect((await fetch(`${BASE_URL}/${slug}/draft-page.md`)).status).toBe(404);
    expect((await fetch(`${BASE_URL}/${slug}/nope.md`)).status).toBe(404);

    const index = await fetch(`${BASE_URL}/${slug}/llms.txt`);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toContain("text/plain");
    const indexText = await index.text();
    expect(indexText.startsWith("# ")).toBe(true);
    expect(indexText).toContain(`[Install](http://localhost:3000/${slug}/setup/install.md)`);
    expect(indexText).toContain(`[Intro](http://localhost:3000/${slug}/intro.md)`);
    expect(indexText).not.toContain("Unlisted");
    expect(indexText).not.toContain("Draft page");

    const full = await (await fetch(`${BASE_URL}/${slug}/llms-full.txt`)).text();
    expect(full).toContain("Run the installer.");
    expect(full).toContain("Welcome aboard.");
    expect(full).toContain(`Source: http://localhost:3000/${slug}/setup/install.md`);
    expect(full).not.toContain("Only by link.");
  });

  it("gives a private site's text to nobody who could not open the page", async () => {
    const slug = `e2e-text-private-${stamp}`;
    await textSite(slug, "PRIVATE");
    for (const path of ["setup/install.md", "llms.txt", "llms-full.txt"]) {
      const res = await fetch(`${BASE_URL}/${slug}/${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("installer");
    }
  });

  it("works on a custom domain, without the site's slug", async () => {
    const slug = `e2e-text-domain-${stamp}`;
    const built = await textSite(slug);
    await prisma.customDomain.create({ data: { siteId: built.site.id, hostname: CUSTOM_HOST, status: "ACTIVE", verificationToken: "t", verifiedAt: new Date() } });

    const port = new URL(BASE_URL).port;
    const origin = `http://${CUSTOM_HOST}${port ? `:${port}` : ""}`;
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.goto(`${origin}/intro`, { waitUntil: "networkidle" });
    const got = await page.evaluate(async () => {
      const read = async (path: string) => {
        const res = await fetch(path);
        return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
      };
      return { md: await read("/setup/install.md"), llms: await read("/llms.txt"), missing: await read("/nope.md") };
    });
    expect(got.md.status).toBe(200);
    expect(got.md.type).toContain("text/markdown");
    expect(got.md.body).toBe("# Install\n\nRun the installer.\n");
    expect(got.llms.status).toBe(200);
    expect(got.llms.body).toContain(`[Install](https://${CUSTOM_HOST}/setup/install.md)`);
    expect(got.missing.status).toBe(404);
    await ctx.close();
  });
});
