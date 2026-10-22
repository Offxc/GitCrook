import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyzeRepository } from "@gitcrook/git-sync/pure";
import { readDirectory } from "./fsRepo";
import { formatGithub, formatJson, formatText, formatTree, passed, type Format } from "./report";

const VERSION = "0.1.0";

const HELP = `gitcrook-docs ${VERSION}
Check a documentation repository the way GitCrook's Git Sync will read it: the same files, front matter,
navigation, links and images, with the same messages (see docs/git-sync/README.md for what each GS-code means).

Usage
  gitcrook-docs check [path]    Report problems. Exits 1 if there are errors (or, with --strict, warnings).
  gitcrook-docs tree  [path]    List the pages the site would have, with their addresses.

  path                   The repository's root (default: the current directory).

Options
  --dir <folder>         The docs folder inside the repository, as set on the Git Sync page. Without it
                         the repository's gitcrook.yaml / .gitbook.yaml decide.
  --strict               Warnings fail the check too.
  --verbose              Show informational notes as well.
  --format <text|json|github>
                         text (default), json, or GitHub Actions annotations.
  --no-color             Plain text output (also set by NO_COLOR).
  -h, --help             This help.
  -v, --version          The version.

Exit status: 0 nothing to fix, 1 problems found, 2 the command could not be run.
`;

export interface RunResult {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** The whole command, without touching the process: arguments in, output and exit status out. */
export async function run(argv: string[], env: Record<string, string | undefined> = {}, isTty = false): Promise<RunResult> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: "string" },
        strict: { type: "boolean", default: false },
        verbose: { type: "boolean", default: false },
        format: { type: "string", default: "text" },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    return { code: 2, stdout: "", stderr: `${error instanceof Error ? error.message : String(error)}\n\n${HELP}` };
  }
  const { values, positionals } = parsed;

  if (values.help) return { code: 0, stdout: HELP, stderr: "" };
  if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr: "" };

  const [command, target = "."] = positionals;
  if (command !== "check" && command !== "tree") return { code: 2, stdout: "", stderr: `${command ? `Unknown command "${command}".` : "Say what to do."}\n\n${HELP}` };
  if (positionals.length > 2) return { code: 2, stdout: "", stderr: `Too many arguments.\n\n${HELP}` };
  const format = values.format as Format;
  if (format !== "text" && format !== "json" && format !== "github") return { code: 2, stdout: "", stderr: `Unknown format "${values.format}": use text, json or github.\n` };

  const root = resolve(target);
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    return { code: 2, stdout: "", stderr: `"${target}" is not a directory.\n` };
  }

  const analysis = await analyzeRepository(await readDirectory(root), { rootDir: values.dir });
  const ok = passed(analysis, values.strict);
  const color = isTty && !values["no-color"] && !env.NO_COLOR;

  if (command === "tree") return { code: analysis.failure ? 1 : 0, stdout: formatTree(analysis), stderr: analysis.failure ? `A sync would not run: ${analysis.failure}\n` : "" };
  const stdout = format === "json" ? formatJson(analysis, values.strict) : format === "github" ? formatGithub(analysis, values.verbose) : formatText(analysis, { verbose: values.verbose, color });
  return { code: ok ? 0 : 1, stdout, stderr: "" };
}

/** Run as a program. */
export async function main(): Promise<void> {
  const result = await run(process.argv.slice(2), process.env, Boolean(process.stdout.isTTY));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
