import { prisma, type GitSource, type Prisma } from "@gitcrook/db";
import {
  buildNavigation,
  cleanRepoPath,
  containerPageBlocks,
  Diagnostics,
  diagnostic,
  readRepoConfig,
  resolveRepoLink,
  type Diagnostic,
  type NavFile,
  type NavNode,
  type ParseResult,
} from "@gitcrook/markdown";
import { extractPlainText, variantPrefix, type StructureSection } from "@gitcrook/shared";
import type { SecretBox } from "@gitcrook/shared/server";
import { applyTree, ForeignPagesError, MAX_REDIRECTS_PER_SOURCE, type ApplyStats, type PageWrite } from "./apply";
import { resolveCredential, redactSecrets } from "./credentials";
import { GitHubClient, type BranchInfo, type FetchLike } from "./github/client";
import { GitHostError } from "./github/errors";
import { DEFAULT_LIMITS, type SyncLimits } from "./limits";
import { metaFrom, navFileFrom, readMeta, type SourceMeta } from "./meta";
import { matchMovesById, planChanges, type KnownFile, type Plan } from "./plan";
import { relativeUrl, rewriteBlocks, type Target } from "./rewrite";
import { getParserPool, ParseCrashError, ParseTimeoutError, type ParserPool } from "./parser/pool";
import { decodeRepoText } from "./text";
import { CONFIG_FILE_NAMES, isConfigPath, listFiles } from "./tree";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

/** Imports a file from the repository into the site's file storage. Provided by the host (the worker). */
export interface AssetImporter {
  import(input: { organizationId: string; siteId: string; sourceId: string; path: string; sha: string; bytes: Uint8Array }): Promise<{ assetId: string; url: string } | { error: string }>;
}

export interface SyncDeps {
  secrets: SecretBox | null;
  assets: AssetImporter | null;
  /** Replaces the network, for tests. */
  fetch?: FetchLike;
  apiBase?: string;
  allowedHosts?: readonly string[];
  limits?: Partial<SyncLimits>;
  /** Parses Markdown on a thread that can be stopped. Defaults to the process's shared one; tests pass their own. */
  parser?: ParserPool;
  now?: () => Date;
  /** Told when something is worth a line in the worker's log. Never receives a secret. */
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface SyncOptions {
  trigger: "WEBHOOK" | "POLL" | "MANUAL" | "FULL";
  /** An existing PENDING run to carry out (from the queue). Without one a run is created. */
  runId?: string;
  deliveryId?: string;
  /** Compute what would happen and change nothing, not even a record. */
  dryRun?: boolean;
}

export type RunStatus = "SUCCEEDED" | "PARTIAL" | "FAILED";

export interface RunStats extends Partial<ApplyStats> {
  markdownFiles?: number;
  assetFiles?: number;
  fetched?: number;
  assetsImported?: number;
  warnings: number;
  errors: number;
}

export interface PreviewNode {
  key: string;
  kind: NavNode["kind"];
  title: string;
  slug: string;
  draft: boolean;
  hidden: boolean;
  children: PreviewNode[];
}

export interface SyncOutcome {
  runId: string | null;
  status: RunStatus;
  /** True when nothing needed doing (the branch had not moved). */
  unchanged: boolean;
  fromSha: string | null;
  toSha: string | null;
  stats: RunStats;
  diagnostics: Diagnostic[];
  error: string | null;
  /** For a dry run: the plan, and the tree that would result. */
  preview?: { plan: Plan; tree: PreviewNode[] };
}

const MAX_RECORDED_DIAGNOSTICS = 500;

class RunTimeoutError extends Error {
  constructor() {
    super("The run took too long and was stopped.");
  }
}

// -------------------------------------------------------------------------------------------------
// One run's state
// -------------------------------------------------------------------------------------------------

class Run {
  readonly diagnostics: Diagnostic[] = [];
  readonly stats: RunStats = { warnings: 0, errors: 0 };
  readonly limits: SyncLimits;
  readonly deadline: number;
  secrets: string[] = [];
  runId: string | null = null;

  constructor(
    readonly deps: SyncDeps,
    readonly source: GitSource,
    readonly options: SyncOptions,
    readonly now: () => Date,
  ) {
    this.limits = { ...DEFAULT_LIMITS, ...deps.limits };
    this.deadline = now().getTime() + this.limits.runTimeoutMs;
  }

  add(...items: Diagnostic[]) {
    this.diagnostics.push(...items);
  }

  /** The docs directory in effect: the source's, else the one the repository's own configuration names. */
  docsDir = "";

  /** A path as the repository shows it: the docs directory is part of it. */
  where(path: string): string {
    return this.docsDir ? `${this.docsDir}/${path}` : path;
  }

  checkTime() {
    if (this.now().getTime() > this.deadline) throw new RunTimeoutError();
  }

  outcome(status: RunStatus, extra: Partial<SyncOutcome> & { toSha: string | null }): SyncOutcome {
    this.stats.warnings = this.diagnostics.filter((d) => d.severity === "warning").length;
    this.stats.errors = this.diagnostics.filter((d) => d.severity === "error").length + (status === "FAILED" && extra.error ? 1 : 0);
    return { runId: this.runId, status, unchanged: false, fromSha: this.source.lastSyncedSha, stats: this.stats, diagnostics: this.diagnostics, error: null, ...extra };
  }
}

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

/**
 * One sync of one source: read the branch, work out what changed, parse it, build the navigation, and apply the
 * result in a single transaction. It never throws for what is in the repository; every problem becomes a diagnostic
 * on the run. A failure rolls back and leaves the site as it was, and `lastSyncedSha` moves only on success.
 */
export async function runSync(deps: SyncDeps, sourceId: string, options: SyncOptions): Promise<SyncOutcome> {
  const now = deps.now ?? (() => new Date());
  const source = await prisma.gitSource.findUnique({ where: { id: sourceId } });
  if (!source) {
    return { runId: null, status: "FAILED", unchanged: false, fromSha: null, toSha: null, stats: { warnings: 0, errors: 1 }, diagnostics: [], error: "The source no longer exists." };
  }

  const run = new Run(deps, source, options, now);
  const started = now();

  if (!options.dryRun) {
    const data = { status: "RUNNING" as const, startedAt: started, heartbeatAt: started };
    if (options.runId) {
      await prisma.gitSyncRun.updateMany({ where: { id: options.runId }, data });
      run.runId = options.runId;
    } else {
      run.runId = (await prisma.gitSyncRun.create({ data: { sourceId, trigger: options.trigger, deliveryId: options.deliveryId ?? null, fromSha: source.lastSyncedSha, toSha: "", ...data }, select: { id: true } })).id;
    }
    await prisma.gitSource.updateMany({ where: { id: sourceId, status: { not: "PAUSED" } }, data: { status: "SYNCING" } });
  }
  const heartbeat = run.runId ? setInterval(() => void prisma.gitSyncRun.updateMany({ where: { id: run.runId! }, data: { heartbeatAt: now() } }).catch(() => undefined), 10_000) : null;

  let outcome: SyncOutcome;
  let failure: unknown = null;
  try {
    outcome = await execute(run);
  } catch (error) {
    failure = error;
    outcome = run.outcome("FAILED", { ...failureOf(error, run.secrets, deps.log), toSha: null });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  // However it failed, the source says so (and a person is told, unless it is the kind of failure that clears itself).
  if (outcome.status === "FAILED" && !options.dryRun) await markFailed(sourceId, redactSecrets(outcome.error ?? "The sync failed.", run.secrets), failure, now());

  if (run.runId) {
    // updateMany: the source (and with it its runs) may have been disconnected while this one was going.
    await prisma.gitSyncRun.updateMany({
      where: { id: run.runId },
      data: {
        status: outcome.status,
        toSha: outcome.toSha ?? "",
        finishedAt: now(),
        stats: outcome.stats as unknown as Prisma.InputJsonValue,
        diagnostics: capDiagnostics(outcome.diagnostics, run.secrets) as unknown as Prisma.InputJsonValue,
        error: outcome.error ? redactSecrets(outcome.error, run.secrets).slice(0, 2000) : null,
      },
    });
  }
  return outcome;
}

async function execute(run: Run): Promise<SyncOutcome> {
  const { source, deps, options } = run;
  const credential = await resolveCredential(source.credentialId, deps.secrets);
  run.secrets = credential.secrets;
  const client = new GitHubClient({
    getToken: credential.getToken,
    fetch: deps.fetch,
    apiBase: deps.apiBase,
    allowedHosts: deps.allowedHosts,
    sleep: deps.sleep,
    now: () => run.now().getTime(),
    onNotice: (n) => run.add(diagnostic("GS-301", n.message)),
  });

  const result = await client.getBranch(source.owner, source.repo, source.branch, { etag: options.trigger === "POLL" ? source.etag : null });
  if (result.notModified) return { ...run.outcome("SUCCEEDED", { toSha: source.lastSyncedSha }), unchanged: true };

  if (!result.protected) run.add(diagnostic("GS-305", `Branch "${source.branch}" is not protected, so anyone with write access can change what the site shows.`));

  // Nothing has been pushed since the last successful sync. (A source in an error state is synced again anyway.)
  if (options.trigger !== "FULL" && !options.dryRun && source.lastSyncedSha === result.sha && source.status !== "ERROR") {
    await markChecked(source.id, result.etag, run.now());
    return { ...run.outcome("SUCCEEDED", { toSha: result.sha }), unchanged: true };
  }

  const outcome = await synchronise(run, client, result);
  if (outcome.status !== "FAILED" && !options.dryRun) await markSynced(source.id, result.sha, result.etag, run.now());
  return outcome;
}

// -------------------------------------------------------------------------------------------------
// The sync proper
// -------------------------------------------------------------------------------------------------

interface Parsed {
  path: string;
  sha: string;
  result: ParseResult;
  seed: string;
}

async function synchronise(run: Run, client: GitHubClient, branch: BranchInfo): Promise<SyncOutcome> {
  const { source, options, limits } = run;
  const { owner, repo } = source;
  const fail = (error: string) => run.outcome("FAILED", { toSha: branch.sha, error });

  // --- Configuration ------------------------------------------------------------------------------
  const rootTree = await client.getTree(owner, repo, branch.treeSha);
  const found: { gitcrook: string | null; gitbook: string | null } = { gitcrook: null, gitbook: null };
  for (const entry of rootTree.entries) {
    const name = entry.path.toLowerCase();
    if (entry.type !== "blob" || !CONFIG_FILE_NAMES.has(name)) continue;
    const text = await readText(run, client, entry.sha, limits.maxConfigBytes, entry.path);
    if (text !== null) found[name.startsWith("gitcrook") ? "gitcrook" : "gitbook"] = text;
  }
  const configDiags = { gitcrook: new Diagnostics("gitcrook.yaml"), gitbook: new Diagnostics(".gitbook.yaml") };
  let config = readRepoConfig(found, configDiags);
  const rootDir = cleanRepoPath(source.rootDir) ?? config.root;
  run.docsDir = rootDir;

  run.checkTime();
  const listing = await listFiles(client, { owner, repo, branch: source.branch, repoTreeSha: branch.treeSha, rootDir, summaryPath: config.summaryPath, limits });
  run.add(...listing.diagnostics.map((d) => (d.path ? { ...d, path: run.where(d.path) } : d)));

  // A gitcrook.yaml inside the docs directory refines the one at the repository root.
  const inside = rootDir ? listing.files.find((f) => f.kind === "config" && !f.path.includes("/") && f.path.toLowerCase().startsWith("gitcrook.y")) : undefined;
  if (inside) {
    const text = await readText(run, client, inside.sha, limits.maxConfigBytes, run.where(inside.path));
    if (text !== null) config = readRepoConfig({ gitcrook: text, gitbook: found.gitbook }, configDiags);
  }
  run.add(...configDiags.gitcrook.items, ...configDiags.gitbook.items);

  const summaryFile = listing.files.find((f) => f.kind === "config" && f.path.toLowerCase() === config.summaryPath.toLowerCase());
  const summary = summaryFile ? await readText(run, client, summaryFile.sha, limits.maxConfigBytes, run.where(summaryFile.path)) : null;

  // --- What changed -------------------------------------------------------------------------------
  const rows = await prisma.page.findMany({
    where: { sourceId: source.id },
    select: { id: true, parentId: true, slug: true, sourcePath: true, sourceBlobSha: true, frontMatterId: true, deletedAt: true, sourceMeta: true },
  });
  const fileRows = rows.filter((r) => r.sourcePath !== null && !/^(dir|group):/.test(r.sourcePath));
  const known: KnownFile[] = fileRows.map((r) => ({ path: r.sourcePath!, sha: r.sourceBlobSha, deleted: r.deletedAt !== null, frontMatterId: r.frontMatterId }));
  const metaOf = new Map(fileRows.map((r) => [r.sourcePath!, readMeta(r.sourceMeta)]));

  const markdownFiles = listing.files.filter((f) => f.kind === "markdown");
  const markdownByPath = new Map(markdownFiles.map((f) => [f.path, f]));
  const assetFiles = new Map(listing.files.filter((f) => f.kind === "asset").map((f) => [f.path, f]));
  run.stats.markdownFiles = markdownFiles.length;
  run.stats.assetFiles = assetFiles.size;

  let plan = planChanges(known, markdownFiles.map((f) => ({ path: f.path, sha: f.sha })));

  // --- Read and parse -----------------------------------------------------------------------------
  const texts = new Map<string, string>();
  const parsed = new Map<string, Parsed>();
  const skipped = new Set<string>();

  // The same file content under several names is fetched once, and what is read in total is bounded.
  const textBySha = new Map<string, Promise<string | null>>();
  let markdownBytes = 0;

  const fetchMarkdown = async (paths: readonly string[]) => {
    await mapLimit(
      paths.filter((p) => !texts.has(p) && !skipped.has(p)),
      limits.concurrency,
      async (path) => {
        run.checkTime();
        const file = markdownByPath.get(path)!;
        if (file.size > limits.maxMarkdownBytes) {
          run.add(diagnostic("GS-150", `"${run.where(path)}" is ${file.size} bytes; the limit is ${limits.maxMarkdownBytes}. It was skipped.`, { path: run.where(path) }));
          skipped.add(path);
          return;
        }
        let pending = textBySha.get(file.sha);
        if (!pending) {
          if (markdownBytes + file.size > limits.maxMarkdownRunBytes) {
            run.add(diagnostic("GS-150", `"${run.where(path)}" was skipped: this run has already read ${limits.maxMarkdownRunBytes} bytes of Markdown.`, { path: run.where(path) }));
            skipped.add(path);
            return;
          }
          markdownBytes += file.size;
          pending = readText(run, client, file.sha, limits.maxMarkdownBytes, run.where(path));
          textBySha.set(file.sha, pending);
          run.stats.fetched = (run.stats.fetched ?? 0) + 1;
        }
        const text = await pending;
        if (text === null) skipped.add(path);
        else texts.set(path, text);
      },
    );
  };

  const seedFor = (path: string): string => metaOf.get(path)?.idSeed ?? path;
  const parser = run.deps.parser ?? getParserPool();
  const parseAll = async (paths: readonly string[], seeds: ReadonlyMap<string, string>) => {
    for (const path of paths) {
      const text = texts.get(path);
      if (text === undefined) continue;
      const seed = seeds.get(path) ?? path;
      run.checkTime();
      try {
        // `{% include %}` reads other files of the repository: the parser asks for them, and they are fetched on demand.
        const result = await parser.parse(text, { path, idSeed: seed }, async (target) => {
          const resolved = resolveRepoLink(path, target);
          if (!resolved || "escapes" in resolved) return null;
          if (!texts.has(resolved.path) && markdownByPath.has(resolved.path)) await fetchMarkdown([resolved.path]);
          return texts.get(resolved.path) ?? null;
        });
        parsed.set(path, { path, sha: markdownByPath.get(path)!.sha, result, seed });
      } catch (error) {
        if (!(error instanceof ParseTimeoutError || error instanceof ParseCrashError)) throw error;
        run.add(diagnostic("GS-208", `"${run.where(path)}" was skipped: ${error.message}`, { path: run.where(path) }));
        skipped.add(path);
      }
    }
  };

  const changed = [...plan.added, ...plan.modified, ...plan.revived.filter((r) => r.modified).map((r) => r.path)];
  await fetchMarkdown(changed);
  await parseAll(changed, new Map(plan.modified.map((p) => [p, seedFor(p)])));

  // A page whose file moved *and* changed is recognised by its front-matter id; it keeps its block ids.
  plan = matchMovesById(plan, known, (path) => parsed.get(path)?.result.frontMatter.id ?? null);
  const movedFrom = new Map(plan.moves.map((m) => [m.to, m.from]));
  const reseed = new Map(plan.moves.filter((m) => m.by === "id").map((m) => [m.to, seedFor(m.from)]));
  if (reseed.size > 0) await parseAll([...reseed.keys()], reseed);

  // Anything we hold nothing for (no remembered metadata) is read now.
  const unknown = markdownFiles.map((f) => f.path).filter((p) => !parsed.has(p) && !skipped.has(p) && !metaOf.get(p) && !metaOf.get(movedFrom.get(p) ?? ""));
  await fetchMarkdown(unknown);
  await parseAll(unknown, new Map(unknown.map((p) => [p, p])));
  run.checkTime();

  // --- The navigation -----------------------------------------------------------------------------
  const navFiles: NavFile[] = [];
  for (const file of markdownFiles) {
    if (skipped.has(file.path)) {
      // A file that could not be read this time (too big, not text, took too long) leaves the page it already made as it was.
      const previous = metaOf.get(file.path);
      if (previous) navFiles.push(navFileFrom(file.path, previous));
      continue;
    }
    const fresh = parsed.get(file.path);
    if (fresh) {
      navFiles.push({ path: file.path, frontMatter: fresh.result.frontMatter, title: fresh.result.title });
      continue;
    }
    const meta = metaOf.get(file.path) ?? metaOf.get(movedFrom.get(file.path) ?? "");
    if (meta) navFiles.push(navFileFrom(file.path, meta));
  }
  const nav = buildNavigation({ files: navFiles, config, summary });
  run.add(...nav.diagnostics.map((d) => (d.path && !isConfigPath(d.path, config) ? { ...d, path: run.where(d.path) } : d)));

  const askedRedirects = nav.nodes.reduce(function count(n: number, node: NavNode): number {
    return node.children.reduce(count, n + node.redirectFrom.length);
  }, 0);
  if (askedRedirects > MAX_REDIRECTS_PER_SOURCE) {
    run.add(diagnostic("GS-207", `${askedRedirects} old addresses are listed in redirect_from; only the first ${MAX_REDIRECTS_PER_SOURCE} are used.`));
  }

  // A configuration error stops the run before anything is touched.
  const fatal = run.diagnostics.find((d) => d.severity === "error" && d.path !== undefined && isConfigPath(d.path, config));
  if (fatal) return fail(`${fatal.path}${fatal.line ? `:${fatal.line}` : ""}: ${fatal.message}`);

  // --- Where everything will be -------------------------------------------------------------------
  const flat: NavNode[] = [];
  const segmentsOf = new Map<string, string[]>();
  const collect = (nodes: NavNode[], prefix: string[]) => {
    for (const n of nodes) {
      const here = [...prefix, n.slug];
      segmentsOf.set(n.key, here);
      flat.push(n);
      collect(n.children, here);
    }
  };
  collect(nav.nodes, []);
  const inTree = new Set(flat.map((n) => n.key));
  const prefix = variantPrefix(await loadSections(source.siteId), source.variantId) ?? [];

  // Pages that link to something that moved, appeared or vanished are written again.
  const oldSegments = oldSegmentsOf(rows);
  const joined = (segs: readonly string[] | undefined) => (segs ? segs.join("/") : "");
  const changedTargets = new Set<string>();
  for (const n of flat) {
    const before = oldSegments.get(movedFrom.get(n.key) ?? n.key);
    if (!before || joined(before) !== joined(segmentsOf.get(n.key))) {
      changedTargets.add(n.key);
      const from = movedFrom.get(n.key);
      if (from) changedTargets.add(from);
      if (!n.sourcePath) changedTargets.add(n.key.replace(/^(dir|group):/, ""));
    }
  }
  for (const key of oldSegments.keys()) if (!inTree.has(key)) changedTargets.add(key);

  const dependents = fileRows
    .filter((r) => !r.deletedAt && inTree.has(r.sourcePath!) && !parsed.has(r.sourcePath!) && !skipped.has(r.sourcePath!))
    .filter((r) => (metaOf.get(r.sourcePath!)?.pageLinks ?? []).some((t) => changedTargets.has(t)))
    .map((r) => r.sourcePath!);
  if (dependents.length > 0) {
    await fetchMarkdown(dependents);
    await parseAll(dependents, new Map(dependents.map((p) => [p, seedFor(p)])));
  }

  // --- Assets -------------------------------------------------------------------------------------
  const pageTargets = new Map<string, Target>();
  for (const n of flat) pageTargets.set(n.key, { kind: "page", segments: segmentsOf.get(n.key)! });
  const assetUrls = new Map<string, string>();
  const lookup = (path: string): Target | undefined => {
    const page = pageTargets.get(path);
    if (page) return page;
    const url = assetUrls.get(path);
    return url ? { kind: "asset", url } : undefined;
  };

  const written = [...parsed.values()].filter((p) => inTree.has(p.path));
  const wantedAssets = new Set<string>();
  for (const page of written) {
    const probe = rewriteBlocks(page.result.blocks, {
      fromPath: page.path,
      pageSegments: segmentsOf.get(page.path) ?? [],
      lookup: (p) => pageTargets.get(p) ?? (assetFiles.has(p) ? { kind: "asset", url: "pending" } : undefined),
    });
    for (const a of probe.assets) if (assetFiles.has(a)) wantedAssets.add(a);
  }
  await importAssets(run, client, [...wantedAssets].sort(), assetFiles, assetUrls);

  // --- What to write ------------------------------------------------------------------------------
  const writes = new Map<string, PageWrite>();
  for (const page of written) {
    const rewritten = rewriteBlocks(page.result.blocks, { fromPath: page.path, pageSegments: segmentsOf.get(page.path)!, lookup });
    const own: Diagnostic[] = [
      ...page.result.diagnostics.map((d) => ({ ...d, path: run.where(page.path) })),
      ...rewritten.problems.map((p) => diagnostic(p.code, p.message, { path: run.where(page.path) })),
    ];
    run.add(...own);
    const meta: SourceMeta = metaFrom(page.seed, page.result.frontMatter, page.result.title, rewritten.pageLinks, rewritten.assets, own);
    writes.set(page.path, { blocks: rewritten.blocks, contentText: extractPlainText(rewritten.blocks), blobSha: page.sha, meta });
  }
  // Pages that were not read this run still have the problems they had; keep reporting them until they are fixed.
  for (const row of fileRows) {
    if (row.deletedAt || !inTree.has(row.sourcePath!) || parsed.has(row.sourcePath!)) continue;
    run.add(...(metaOf.get(row.sourcePath!)?.diagnostics ?? []));
  }
  for (const n of flat) {
    if (n.kind !== "generated") continue;
    const segs = segmentsOf.get(n.key)!;
    const blocks = containerPageBlocks(n, (child) => relativeUrl(segs, segmentsOf.get(child.key) ?? []), n.key);
    writes.set(n.key, { blocks, contentText: extractPlainText(blocks), blobSha: null, meta: null });
  }

  // --- A preview, or the real thing ---------------------------------------------------------------
  if (options.dryRun) {
    const status = run.diagnostics.some((d) => d.severity === "error") ? "PARTIAL" : "SUCCEEDED";
    return run.outcome(status, { toSha: branch.sha, preview: { plan, tree: previewOf(nav.nodes) } });
  }

  run.checkTime();
  const applied = await prisma.$transaction(
    (tx) => applyTree(tx, { source: { id: source.id, siteId: source.siteId, variantId: source.variantId }, tree: nav.nodes, writes, moves: plan.moves, commitSha: branch.sha, prefix, now: run.now() }),
    { timeout: Math.max(30_000, run.deadline - run.now().getTime()), maxWait: 30_000 },
  );
  Object.assign(run.stats, applied);
  await purgeExpired(source.id, source.deleteGraceDays, run.now());

  return run.outcome(run.diagnostics.some((d) => d.severity === "error") ? "PARTIAL" : "SUCCEEDED", { toSha: branch.sha });
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

async function importAssets(run: Run, client: GitHubClient, paths: string[], files: Map<string, { path: string; sha: string; size: number }>, urls: Map<string, string>) {
  if (paths.length === 0) return;
  const { source, limits, deps } = run;
  const existing = await prisma.asset.findMany({ where: { sourceId: source.id, sourcePath: { in: paths } }, select: { id: true, sourcePath: true, sourceBlobSha: true } });
  const have = new Map(existing.map((a) => [a.sourcePath!, a]));
  let budget = limits.maxRunBytes;

  await mapLimit(paths, limits.concurrency, async (path) => {
    const file = files.get(path)!;
    const row = have.get(path);
    if (row && row.sourceBlobSha === file.sha) {
      urls.set(path, `/api/files/${row.id}`);
      return;
    }
    // A preview reads no file bodies, but a file that is in the repository is not a missing one.
    if (run.options.dryRun) {
      urls.set(path, "pending");
      return;
    }
    if (!deps.assets) return;
    run.checkTime();
    if (file.size > limits.maxAssetBytes) {
      run.add(diagnostic("GS-150", `"${run.where(path)}" is ${file.size} bytes; the limit for a file is ${limits.maxAssetBytes}. It was skipped.`, { path: run.where(path) }));
      return;
    }
    if (budget < file.size) {
      run.add(diagnostic("GS-150", `"${run.where(path)}" was skipped: this run has already read ${limits.maxRunBytes} bytes of files.`, { path: run.where(path) }));
      return;
    }
    budget -= file.size;
    const bytes = await client.getBlob(source.owner, source.repo, file.sha, { maxBytes: limits.maxAssetBytes });
    const imported = await deps.assets.import({ organizationId: source.organizationId, siteId: source.siteId, sourceId: source.id, path, sha: file.sha, bytes });
    if ("error" in imported) {
      run.add(diagnostic("GS-131", `"${run.where(path)}" could not be imported: ${imported.error}`, { path: run.where(path) }));
      return;
    }
    urls.set(path, imported.url);
    run.stats.assetsImported = (run.stats.assetsImported ?? 0) + 1;
  });
}

/** Runs `fn` over `items` with at most `limit` in flight, stopping at the first failure. */
async function mapLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** A text file from the repository, or null (with a diagnostic) if it is binary, an LFS pointer, or unreadable. */
async function readText(run: Run, client: GitHubClient, sha: string, maxBytes: number, shownPath: string): Promise<string | null> {
  const bytes = await client.getBlob(run.source.owner, run.source.repo, sha, { maxBytes });
  const decoded = decodeRepoText(bytes, shownPath);
  if ("diagnostic" in decoded) {
    run.add(decoded.diagnostic);
    return null;
  }
  return decoded.text;
}

async function loadSections(siteId: string): Promise<StructureSection[]> {
  const sections = await prisma.section.findMany({
    where: { siteId },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, spaces: { orderBy: { order: "asc" }, select: { id: true, slug: true, variants: { orderBy: { order: "asc" }, select: { id: true, slug: true, isDefault: true } } } } },
  });
  return sections as unknown as StructureSection[];
}

/** The URL segments every live page of this source has now, by key (without the variant prefix). */
function oldSegmentsOf(rows: { id: string; parentId: string | null; slug: string; sourcePath: string | null; deletedAt: Date | null }[]): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string[]>();
  for (const row of rows) {
    if (row.deletedAt || !row.sourcePath) continue;
    const segs: string[] = [];
    const seen = new Set<string>();
    for (let r: typeof row | undefined = row; r && !seen.has(r.id); r = r.parentId ? byId.get(r.parentId) : undefined) {
      seen.add(r.id);
      segs.unshift(r.slug);
    }
    out.set(row.sourcePath, segs);
  }
  return out;
}

function previewOf(nodes: NavNode[]): PreviewNode[] {
  return nodes.map((n) => ({ key: n.key, kind: n.kind, title: n.title, slug: n.slug, draft: n.draft, hidden: n.hidden, children: previewOf(n.children) }));
}

/** Rows stay for `graceDays` after their file vanished, then go for good (and their history with them). */
async function purgeExpired(sourceId: string, graceDays: number, now: Date) {
  const cutoff = new Date(now.getTime() - graceDays * 86_400_000);
  await prisma.page.deleteMany({ where: { sourceId, deletedAt: { not: null, lt: cutoff } } });
}

/**
 * The source's bookkeeping after a run. All of it is written with `updateMany` (the source may have been
 * disconnected while the run was going) and none of it overrides a source that someone paused meanwhile.
 */
async function markChecked(sourceId: string, etag: string | null, now: Date) {
  await prisma.gitSource.updateMany({ where: { id: sourceId }, data: { lastCheckedAt: now, etag } });
  await release(sourceId);
}

async function markSynced(sourceId: string, sha: string, etag: string | null, now: Date) {
  await prisma.gitSource.updateMany({ where: { id: sourceId }, data: { lastSyncedSha: sha, lastSyncedAt: now, lastCheckedAt: now, lastError: null, etag } });
  await release(sourceId);
}

async function markFailed(sourceId: string, message: string, error: unknown, now: Date) {
  await prisma.gitSource.updateMany({ where: { id: sourceId }, data: { lastError: message.slice(0, 1000), lastCheckedAt: now } });
  // A rate limit or an outage clears up by itself; a bad credential or a missing branch needs a person.
  const retryable = error instanceof GitHostError && error.retryable;
  await prisma.gitSource.updateMany({ where: { id: sourceId, status: { in: ["SYNCING", "IDLE", "ERROR"] } }, data: { status: retryable ? "IDLE" : "ERROR" } });
}

async function release(sourceId: string) {
  await prisma.gitSource.updateMany({ where: { id: sourceId, status: { in: ["SYNCING", "ERROR"] } }, data: { status: "IDLE" } });
}

function failureOf(error: unknown, secrets: string[], log?: (m: string) => void): { error: string } {
  if (error instanceof ForeignPagesError || error instanceof RunTimeoutError) return { error: error.message };
  if (error instanceof GitHostError) return { error: redactSecrets(error.message, secrets) };
  // Anything else is a bug in Git Sync, not in the repository. Say so plainly and keep the detail for the log.
  log?.(`unexpected error: ${redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error), secrets)}`);
  return { error: "Git Sync hit an unexpected error. The site was not changed; the worker log has the details." };
}

/** Keeps a run's stored diagnostics bounded, the worst first, with anything that looks like a secret scrubbed. */
function capDiagnostics(items: Diagnostic[], secrets: string[]): Diagnostic[] {
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...items].sort((a, b) => rank[a.severity] - rank[b.severity]);
  const kept = sorted.slice(0, MAX_RECORDED_DIAGNOSTICS).map((d) => ({ ...d, message: redactSecrets(d.message, secrets).slice(0, 1000) }));
  if (sorted.length > MAX_RECORDED_DIAGNOSTICS) kept.push({ code: "GS-201", severity: "info", message: `${sorted.length - MAX_RECORDED_DIAGNOSTICS} more messages were not recorded.` });
  return kept;
}
