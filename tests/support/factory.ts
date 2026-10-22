import { prisma, type AudienceMode, type Role } from "@gitcrook/db";

/** Empties every application table. Migrations' own bookkeeping table is left alone. */
export async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const next = () => ++counter;

export async function makeUser(overrides: { email?: string | null; emailVerified?: Date | null; name?: string } = {}) {
  const n = next();
  return prisma.user.create({
    data: {
      name: overrides.name ?? `User ${n}`,
      email: overrides.email === undefined ? `user${n}@example.test` : overrides.email,
      emailVerified: overrides.emailVerified ?? null,
    },
  });
}

export async function makeOrg(members: { user: { id: string }; role: Role }[] = []) {
  const n = next();
  const org = await prisma.organization.create({ data: { name: `Org ${n}`, slug: `org-${n}` } });
  for (const m of members) await prisma.membership.create({ data: { organizationId: org.id, userId: m.user.id, role: m.role } });
  return org;
}

export interface SiteOptions {
  organizationId: string;
  audienceMode?: AudienceMode;
  slug?: string;
  /** Extra sections, spaces and variants, as a shape: `[[2, 1], [1, 2]]` is two sections, the first with 2 spaces, the second with 1 space... see `makeStructure`. */
  structure?: StructureSpec;
}

/** sections → spaces → variant count. Each variant list's first entry is the default unless `defaultIndex` says otherwise. */
export type StructureSpec = { slug?: string; spaces: { slug?: string; variants: { slug?: string; isDefault?: boolean }[] }[] }[];

const DEFAULT_STRUCTURE: StructureSpec = [{ slug: "documentation", spaces: [{ slug: "docs", variants: [{ slug: "main", isDefault: true }] }] }];

export async function makeSite(options: SiteOptions) {
  const n = next();
  const site = await prisma.site.create({
    data: {
      organizationId: options.organizationId,
      name: `Site ${n}`,
      slug: options.slug ?? `site-${n}`,
      theme: {},
      audienceMode: options.audienceMode ?? "PUBLIC",
    },
  });

  const structure = options.structure ?? DEFAULT_STRUCTURE;
  const variants: { id: string; slug: string; isDefault: boolean; spaceId: string; sectionId: string }[] = [];
  const sections = [];
  for (const [si, sec] of structure.entries()) {
    const section = await prisma.section.create({ data: { siteId: site.id, title: `Section ${si}`, slug: sec.slug ?? `section-${si}`, order: si } });
    sections.push(section);
    for (const [pi, sp] of sec.spaces.entries()) {
      const space = await prisma.space.create({ data: { sectionId: section.id, title: `Space ${pi}`, slug: sp.slug ?? `space-${pi}`, order: pi } });
      for (const [vi, v] of sp.variants.entries()) {
        const variant = await prisma.variant.create({
          data: { spaceId: space.id, name: `Variant ${vi}`, slug: v.slug ?? `variant-${vi}`, order: vi, isDefault: v.isDefault ?? vi === 0 },
        });
        variants.push({ id: variant.id, slug: variant.slug, isDefault: variant.isDefault, spaceId: space.id, sectionId: section.id });
      }
    }
  }
  return { site, sections, variants, variant: variants[0]! };
}

export interface PageOptions {
  variantId: string;
  siteId: string;
  slug: string;
  title?: string;
  parentId?: string | null;
  order?: number;
  isGroup?: boolean;
  isDraft?: boolean;
  content?: object;
  contentText?: string;
}

export async function makePage(options: PageOptions) {
  return prisma.page.create({
    data: {
      variantId: options.variantId,
      siteId: options.siteId,
      parentId: options.parentId ?? null,
      slug: options.slug,
      title: options.title ?? options.slug,
      order: options.order ?? next(),
      isGroup: options.isGroup ?? false,
      isDraft: options.isDraft ?? false,
      content: options.content ?? (options.isGroup ? [] : [{ type: "paragraph", content: [] }]),
      contentText: options.contentText ?? "",
    },
  });
}
