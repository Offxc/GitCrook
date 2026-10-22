import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { prisma } from "@gitcrook/db";
import { makeOrg, makePage, makeSite, makeUser, type StructureSpec } from "../support/factory";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
/** A hostname the browser is told resolves to the local server, to exercise custom domains. */
export const CUSTOM_HOST = "docs.e2e.test";

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", `--host-resolver-rules=MAP ${CUSTOM_HOST} 127.0.0.1`],
  });
}

export async function newContext(browser: Browser, opts: { sessionToken?: string; width?: number } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: opts.width ?? 1400, height: 800 } });
  if (opts.sessionToken) {
    await ctx.addCookies([{ name: "authjs.session-token", value: opts.sessionToken, url: BASE_URL }]);
  }
  return ctx;
}

/** A signed-in admin of a fresh organisation. */
export async function makeAdmin() {
  const user = await makeUser();
  const org = await makeOrg([{ user, role: "ADMIN" }]);
  const sessionToken = `e2e-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) } });
  return { user, org, sessionToken };
}

/**
 * A site with `groups` groups of `perGroup` pages (slugs `g<G>-p<N>`), all in one default variant. The fifth
 * page of every group has one child (`g<G>-p5-child`), so there are collapsible entries to test. `pages` lists
 * every page a reader can open in the order previous/next walks them, and `firstOfGroup` the index of each
 * group's first page.
 */
export async function makeLongSite(organizationId: string, slug: string, groups = 4, perGroup = 15) {
  const built = await makeSite({ organizationId, slug });
  let order = 0;
  const pages: { slug: string; path: string[]; title: string }[] = [];
  const firstOfGroup: number[] = [];
  for (let g = 1; g <= groups; g++) {
    const group = await makePage({ variantId: built.variant.id, siteId: built.site.id, slug: `group-${g}`, title: `Group ${g}`, isGroup: true, order: order++ });
    firstOfGroup.push(pages.length);
    for (let p = 1; p <= perGroup; p++) {
      const pageSlug = `g${g}-p${p}`;
      const parent = await makePage({ variantId: built.variant.id, siteId: built.site.id, slug: pageSlug, title: `G${g} Page ${p}`, parentId: group.id, order: p });
      pages.push({ slug: pageSlug, path: [`group-${g}`, pageSlug], title: `G${g} Page ${p}` });
      if (p === 5 && perGroup >= 5) {
        const childSlug = `${pageSlug}-child`;
        await makePage({ variantId: built.variant.id, siteId: built.site.id, slug: childSlug, title: `G${g} Child ${p}`, parentId: parent.id, order: 0 });
        pages.push({ slug: childSlug, path: [`group-${g}`, pageSlug, childSlug], title: `G${g} Child ${p}` });
      }
    }
  }
  return { ...built, pages, firstOfGroup };
}

export async function addPages(variantId: string, siteId: string, slugs: string[]) {
  let order = 0;
  for (const slug of slugs) await makePage({ variantId, siteId, slug, title: slug.replace(/-/g, " "), order: order++ });
}

export const SIDEBAR = 'nav[data-placement="sidebar"]';
export const SIDEBAR_SCROLL = `${SIDEBAR} div.overflow-y-auto`;
export const HEADER = 'header[data-placement="header"]';

/** Tags the shell's long-lived elements so a later check can tell whether they were replaced. */
export async function markShell(page: Page) {
  await page.evaluate(
    ({ sidebar, scroll, header }) => {
      const w = window as unknown as Record<string, unknown>;
      w.__shellLoaded = true;
      for (const [key, selector] of Object.entries({ sidebar, scroll, header, root: "[data-site-root]", footer: "footer" })) {
        const el = document.querySelector(selector) as (Element & { __mark?: string }) | null;
        if (el) el.__mark = key;
      }
    },
    { sidebar: SIDEBAR, scroll: SIDEBAR_SCROLL, header: HEADER },
  );
}

/** Which tagged elements are still the very same DOM nodes, and whether the document itself was ever reloaded. */
export async function shellState(page: Page) {
  return page.evaluate(
    ({ sidebar, scroll, header }) => {
      const same = (selector: string, key: string) => (document.querySelector(selector) as (Element & { __mark?: string }) | null)?.__mark === key;
      return {
        noReload: (window as unknown as Record<string, unknown>).__shellLoaded === true,
        sidebar: same(sidebar, "sidebar"),
        scroll: same(scroll, "scroll"),
        header: same(header, "header"),
        root: same("[data-site-root]", "root"),
        footer: same("footer", "footer"),
      };
    },
    { sidebar: SIDEBAR, scroll: SIDEBAR_SCROLL, header: HEADER },
  );
}

export const sidebarOffset = (page: Page) => page.$eval(SIDEBAR_SCROLL, (el) => Math.round(el.scrollTop));

export type { StructureSpec };
