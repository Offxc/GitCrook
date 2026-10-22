import type { Diagnostic, Severity } from "./types";

/**
 * Everything the parser and the sync engine can tell an author, each with a stable code so a message can
 * be searched for, documented and asserted on. The text here is the default; callers add the file and line.
 */
export const CATALOGUE = {
  "GS-101": { severity: "error", summary: "Front matter is not valid YAML" },
  "GS-102": { severity: "info", summary: "Unknown front-matter key" },
  "GS-103": { severity: "warning", summary: "Front-matter value has the wrong type" },
  "GS-110": { severity: "warning", summary: "Two pages share a URL; a suffix was added" },
  "GS-120": { severity: "warning", summary: "File is not listed in the explicit navigation" },
  "GS-121": { severity: "error", summary: "Navigation refers to a file that does not exist" },
  "GS-122": { severity: "warning", summary: "File appears more than once in the navigation" },
  "GS-130": { severity: "warning", summary: "Link to a page that does not exist" },
  "GS-131": { severity: "warning", summary: "Image or file that does not exist" },
  "GS-132": { severity: "warning", summary: "Link with an unsafe or unsupported URL" },
  "GS-140": { severity: "info", summary: "File type is not imported" },
  "GS-150": { severity: "error", summary: "File is too large" },
  "GS-151": { severity: "error", summary: "The repository has too many files to import" },
  "GS-160": { severity: "warning", summary: "Symlink, submodule or LFS pointer skipped" },
  "GS-170": { severity: "error", summary: "Path leaves the repository" },
  "GS-201": { severity: "info", summary: "Formatting the editor cannot represent was simplified" },
  "GS-203": { severity: "warning", summary: "Unknown directive; its content is shown as text" },
  "GS-204": { severity: "info", summary: "HTML that is not allowed was removed" },
  "GS-205": { severity: "warning", summary: "Directive has missing or invalid attributes" },
  "GS-206": { severity: "info", summary: "Construct is converted to the nearest equivalent" },
  "GS-207": { severity: "warning", summary: "Document is too deeply nested or too large" },
  "GS-210": { severity: "info", summary: "Tabs are shown as expandable sections" },
  "GS-301": { severity: "warning", summary: "Rate limited, retrying" },
  "GS-302": { severity: "error", summary: "Branch or repository is not reachable" },
  "GS-303": { severity: "error", summary: "Authentication failed" },
} as const satisfies Record<string, { severity: Severity; summary: string }>;

export type DiagnosticCode = keyof typeof CATALOGUE;

export function diagnostic(code: DiagnosticCode, message: string, where: { path?: string; line?: number; column?: number } = {}): Diagnostic {
  return { code, severity: CATALOGUE[code].severity, message, ...where };
}

/** Collects diagnostics while a document is processed, remembering which file they belong to. */
export class Diagnostics {
  readonly items: Diagnostic[] = [];

  constructor(private readonly path?: string) {}

  add(code: DiagnosticCode, message: string, position?: { start?: { line?: number; column?: number } } | null) {
    this.items.push(
      diagnostic(code, message, {
        ...(this.path ? { path: this.path } : {}),
        ...(position?.start?.line ? { line: position.start.line } : {}),
        ...(position?.start?.column ? { column: position.start.column } : {}),
      }),
    );
  }
}
