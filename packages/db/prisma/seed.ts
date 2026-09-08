import { randomBytes } from "node:crypto";
import { prisma } from "../src/client";
import { defaultTheme } from "@voiddocs/shared";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@voidsmp.com" },
    update: {},
    create: { email: "demo@voidsmp.com", name: "Demo User" },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "demo" },
    update: {},
    create: {
      name: "Demo Organization",
      slug: "demo",
      memberships: { create: { userId: user.id, role: "ADMIN" } },
    },
  });
  // upsert's `create` only runs once — make sure the membership exists even on re-seed.
  await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: {},
    create: { organizationId: org.id, userId: user.id, role: "ADMIN" },
  });

  let site = await prisma.site.findUnique({ where: { slug: "demo-docs" } });
  if (!site) {
    site = await prisma.$transaction(async (tx) => {
      const site = await tx.site.create({
        data: { organizationId: org.id, name: "Demo Docs", slug: "demo-docs", theme: defaultTheme() },
      });
      const section = await tx.section.create({
        data: { siteId: site.id, title: "Documentation", slug: "docs", order: 0 },
      });
      const space = await tx.space.create({
        data: { sectionId: section.id, title: "Docs", slug: "docs", order: 0 },
      });
      const variant = await tx.variant.create({
        data: { spaceId: space.id, name: "Default", slug: "default", isDefault: true, order: 0 },
      });
      const intro = await tx.page.create({
        data: {
          variantId: variant.id,
          siteId: site.id,
          title: "Introduction",
          slug: "introduction",
          order: 0,
          content: [
            { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Welcome to VoidDocs", styles: {} }] },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "This seeded page proves the progressive slug router resolves a real Site -> Section -> Space -> Variant -> Page tree end to end.",
                  styles: {},
                },
              ],
            },
          ],
          contentText: "Welcome to VoidDocs. This seeded page proves the progressive slug router works end to end.",
          publishedAt: new Date(),
        },
      });
      await tx.page.create({
        data: {
          variantId: variant.id,
          siteId: site.id,
          parentId: intro.id,
          title: "Nested page",
          slug: "nested-page",
          order: 0,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A child page, reached at /demo-docs/introduction/nested-page.", styles: {} }],
            },
          ],
          contentText: "A child page.",
          publishedAt: new Date(),
        },
      });
      return site;
    });
  }

  // A second Variant on the demo space, so the ~v/{slug} switcher (VariantSwitcher.tsx)
  // has something real to exercise: "Introduction" exists in both (equivalent-page
  // link), "Nested page"/"Block Test Page" only in Default (falls back to v2's root).
  const demoSpace = await prisma.space.findFirst({ where: { section: { siteId: site.id, slug: "docs" }, slug: "docs" } });
  if (demoSpace) {
    const v2Exists = await prisma.variant.findFirst({ where: { spaceId: demoSpace.id, slug: "v2" } });
    if (!v2Exists) {
      const v2 = await prisma.variant.create({
        data: { spaceId: demoSpace.id, name: "v2.0", slug: "v2", isDefault: false, order: 1 },
      });
      await prisma.page.create({
        data: {
          variantId: v2.id,
          siteId: site.id,
          title: "Introduction",
          slug: "introduction",
          order: 0,
          content: [
            { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Welcome to VoidDocs v2.0", styles: {} }] },
            {
              type: "paragraph",
              content: [
                { type: "text", text: "This is the v2.0 variant — switch back to Default from the version dropdown up top.", styles: {} },
              ],
            },
          ],
          contentText: "Welcome to VoidDocs v2.0. This is the v2.0 variant.",
          publishedAt: new Date(),
        },
      });
    }
  }

  // A dev-only session so the dashboard can be exercised in a browser without
  // a real Discord OAuth round trip — never runs outside `prisma db seed`.
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) },
  });

  console.log("Seeded:");
  console.log(`  Org:  ${org.slug}`);
  console.log(`  Site: /${site.slug}`);
  console.log(`  Dev session cookie (authjs.session-token): ${sessionToken}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
