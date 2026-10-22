import type { Analysis } from "@gitcrook/git-sync/pure";

export type Severity = "error" | "warning" | "info";
export type Format = "text" | "json" | "github";

export interface ReportOptions {
  /** Show informational notes as well. */
  verbose: boolean;
  /** Colour the text format. */
  color: boolean;
}

type Finding = Analysis["diagnostics"][number];

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function counts(analysis: Analysis): Record<Severity, number> {
  const out = { error: 0, warning: 0, info: 0 };
  for (const d of analysis.diagnostics) out[d.severity]++;
  return out;
}

/**
 * Whether the check passed. Errors always fail it, as does a repository the server would refuse outright; warnings
 * fail it only when asked to (`--strict`), since a link to a page that does not exist yet is not always a mistake.
 */
export function passed(analysis: Analysis, strict: boolean): boolean {
  const c = counts(analysis);
  return analysis.failure === null && c.error === 0 && (!strict || c.warning === 0);
}

const byLocation = (a: Finding, b: Finding) => (a.path ?? "").localeCompare(b.path ?? "") || (a.line ?? 0) - (b.line ?? 0) || RANK[a.severity] - RANK[b.severity] || a.code.localeCompare(b.code);

/** The findings worth showing, in the order a person reads them: by file, then line. */
export function visible(analysis: Analysis, verbose: boolean): Finding[] {
  return analysis.diagnostics.filter((d) => verbose || d.severity !== "info").sort(byLocation);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function formatText(analysis: Analysis, options: ReportOptions): string {
  const paint = (code: string, text: string) => (options.color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const style = { error: (t: string) => paint("31", t), warning: (t: string) => paint("33", t), info: (t: string) => paint("2", t), bold: (t: string) => paint("1", t), dim: (t: string) => paint("2", t) };

  const lines: string[] = [];
  let currentFile: string | undefined | null = null;
  for (const d of visible(analysis, options.verbose)) {
    if (d.path !== currentFile) {
      if (lines.length > 0) lines.push("");
      lines.push(style.bold(d.path ?? "(repository)"));
      currentFile = d.path;
    }
    const where = d.line ? String(d.line).padStart(4) : "    ";
    lines.push(`  ${style.dim(where)}  ${style[d.severity](d.severity.padEnd(7))} ${style.dim(d.code)}  ${d.message}`);
  }

  if (analysis.failure) {
    if (lines.length > 0) lines.push("");
    lines.push(style.error(`A sync would not run: ${analysis.failure}`));
  }

  const c = counts(analysis);
  const hiddenNotes = options.verbose ? 0 : c.info;
  if (lines.length > 0) lines.push("");
  const parts = [plural(c.error, "error"), plural(c.warning, "warning")];
  if (hiddenNotes > 0) parts.push(`${plural(hiddenNotes, "note")} hidden — add --verbose to see them`);
  lines.push(`${style.bold(plural(analysis.pages.length, "page"))} from ${plural(analysis.markdownFiles, "Markdown file")}; ${parts.join(", ")}`);
  return lines.join("\n") + "\n";
}

export function formatJson(analysis: Analysis, strict: boolean): string {
  return (
    JSON.stringify(
      {
        ok: passed(analysis, strict),
        failure: analysis.failure,
        counts: counts(analysis),
        pages: analysis.pages.length,
        markdownFiles: analysis.markdownFiles,
        assetFiles: analysis.assetFiles,
        diagnostics: [...analysis.diagnostics].sort(byLocation),
      },
      null,
      2,
    ) + "\n"
  );
}

/** GitHub Actions workflow commands: findings show up as annotations on the pull request's files. */
export function formatGithub(analysis: Analysis, verbose: boolean): string {
  const escape = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const escapeProperty = (s: string) => escape(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
  const lines = visible(analysis, verbose).map((d) => {
    const level = d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "notice";
    const props = [d.path ? `file=${escapeProperty(d.path)}` : "", d.line ? `line=${d.line}` : "", `title=${escapeProperty(d.code)}`].filter(Boolean).join(",");
    return `::${level} ${props}::${escape(d.message)}`;
  });
  if (analysis.failure) lines.push(`::error title=GS-FAILED::${escape(`A sync would not run: ${analysis.failure}`)}`);
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/** The pages as an indented list of their addresses, for `gitcrook-docs tree`. */
export function formatTree(analysis: Analysis): string {
  const lines = analysis.pages.map((p) => {
    const depth = p.segments.length - 1;
    const flags = [p.kind === "generated" ? "index" : p.kind === "group" ? "group" : null, p.draft ? "draft" : null, p.hidden ? "hidden" : null].filter(Boolean);
    return `${"  ".repeat(depth)}${p.title}  /${p.segments.join("/")}${flags.length ? `  (${flags.join(", ")})` : ""}`;
  });
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}
