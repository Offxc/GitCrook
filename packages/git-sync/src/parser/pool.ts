import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Worker } from "node:worker_threads";
import type { ParseResult } from "@gitcrook/markdown";

/**
 * Parses Markdown on a separate thread, with a hard time limit.
 *
 * A repository is untrusted, and the Markdown parser is not linear: a few kilobytes of the right shape (thousands of
 * list items, nested directives, setext headings) take it minutes. On the worker's own thread that would stop every
 * other sync and PDF export on the machine, and the run's timeout, which is only checked between files, could not help.
 * Here the thread that parses can be killed: a file that takes too long is reported and skipped, and a fresh thread
 * takes the next one. A memory limit on the thread does the same for a file that eats memory.
 */

export class ParseTimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(`Reading the file took longer than ${seconds} seconds.`);
    this.name = "ParseTimeoutError";
  }
}

export class ParseCrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseCrashError";
  }
}

export interface ParserPoolOptions {
  /** The longest one file may take to parse. */
  timeoutMs?: number;
  /** The most memory the parser thread may use. */
  maxMemoryMb?: number;
  /** The longest the thread may take to start. */
  startupTimeoutMs?: number;
}

export interface ParseRequestOptions {
  path?: string;
  idSeed?: string;
}

/** Asked for the text of an `{% include %}`; null if there is no such file. */
export type IncludeResolver = (target: string) => Promise<string | null>;

interface Job {
  id: number;
  text: string;
  options: ParseRequestOptions;
  includes: Record<string, string>;
  resolve: (value: { result: ParseResult; wanted: string[] }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const MAX_INCLUDE_ROUNDS = 5;

export class ParserPool {
  private worker: Worker | null = null;
  private ready = false;
  private starting: ReturnType<typeof setTimeout> | null = null;
  private current: Job | null = null;
  private readonly queue: Job[] = [];
  private nextId = 1;
  private closed = false;
  private readonly timeoutMs: number;
  private readonly maxMemoryMb: number;
  private readonly startupTimeoutMs: number;

  constructor(options: ParserPoolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxMemoryMb = options.maxMemoryMb ?? 1024;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 60_000;
  }

  /**
   * Parses `text`, following `{% include %}` tags through `resolveInclude` (which may fetch them). Rejects with
   * `ParseTimeoutError` or `ParseCrashError` if the thread had to be stopped.
   */
  async parse(text: string, options: ParseRequestOptions = {}, resolveInclude?: IncludeResolver): Promise<ParseResult> {
    const includes: Record<string, string> = {};
    for (let round = 0; ; round++) {
      const { result, wanted } = await this.enqueue(text, options, includes);
      const missing = wanted.filter((target) => !(target in includes));
      if (!resolveInclude || missing.length === 0 || round >= MAX_INCLUDE_ROUNDS) return result;
      let found = false;
      for (const target of missing) {
        const included = await resolveInclude(target);
        if (included !== null) {
          includes[target] = included;
          found = true;
        }
      }
      if (!found) return result;
    }
  }

  /** Stops the thread and fails whatever is waiting. */
  close(): void {
    this.closed = true;
    this.killWorker(new ParseCrashError("The parser was shut down."));
    for (const job of this.queue.splice(0)) job.reject(new ParseCrashError("The parser was shut down."));
  }

  private enqueue(text: string, options: ParseRequestOptions, includes: Record<string, string>): Promise<{ result: ParseResult; wanted: string[] }> {
    if (this.closed) return Promise.reject(new ParseCrashError("The parser was shut down."));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, text, options, includes: { ...includes }, resolve, reject, timer: null });
      this.pump();
    });
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) return;
    const worker = this.ensureWorker();
    if (!this.ready) return; // started when the thread says it is ready
    this.current = this.queue.shift()!;
    const job = this.current;
    job.timer = setTimeout(() => {
      this.killWorker(new ParseTimeoutError(Math.round(this.timeoutMs / 1000)));
    }, this.timeoutMs);
    worker.postMessage({ id: job.id, text: job.text, options: job.options, includes: job.includes });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Only the worker process ever gets here. The web app's bundler imports this file (through the package's index) but
    // never starts a thread, and when it recognises `new Worker(path)` it tries to bundle the thread's entry point. The
    // module name is built at run time so that it does not.
    const threads = createRequire(import.meta.url)(["node", "worker_threads"].join(":")) as typeof import("node:worker_threads");
    const WorkerThread = threads["Worker"];
    const here = dirname(fileURLToPath(import.meta.url));
    const worker = new WorkerThread(join(here, "bootstrap.mjs"), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: this.maxMemoryMb, maxYoungGenerationSizeMb: 64 },
    });
    // The pool must never be the reason a process stays alive.
    worker.unref();
    this.worker = worker;
    this.ready = false;
    this.starting = setTimeout(() => this.killWorker(new ParseCrashError("The parser thread did not start.")), this.startupTimeoutMs);

    worker.on("message", (message: { ready?: boolean; id?: number; ok?: boolean; result?: ParseResult; wanted?: string[]; error?: string }) => {
      if (worker !== this.worker) return;
      if (message.ready) {
        this.ready = true;
        if (this.starting) clearTimeout(this.starting);
        this.starting = null;
        this.pump();
        return;
      }
      const job = this.current;
      if (!job || message.id !== job.id) return;
      if (job.timer) clearTimeout(job.timer);
      this.current = null;
      if (message.ok) job.resolve({ result: message.result!, wanted: message.wanted ?? [] });
      else job.reject(new ParseCrashError(message.error ?? "The file could not be parsed."));
      this.pump();
    });
    worker.on("error", (error) => {
      if (worker !== this.worker) return;
      const memory = (error as NodeJS.ErrnoException).code === "ERR_WORKER_OUT_OF_MEMORY";
      this.killWorker(new ParseCrashError(memory ? "Reading the file used too much memory." : `The parser stopped: ${error.message}`));
    });
    worker.on("exit", () => {
      if (worker !== this.worker) return;
      this.killWorker(new ParseCrashError("The parser stopped unexpectedly."));
    });
    return worker;
  }

  /** Ends the thread, fails the job it was working on with `reason`, and lets the next job start a fresh one. */
  private killWorker(reason: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    if (this.starting) clearTimeout(this.starting);
    this.starting = null;
    if (worker) void worker.terminate().catch(() => undefined);
    const job = this.current;
    this.current = null;
    if (job) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(reason);
    }
    if (!this.closed) this.pump();
  }
}

let shared: ParserPool | null = null;

/** The one pool a process uses. Created on first use. */
export function getParserPool(): ParserPool {
  shared ??= new ParserPool();
  return shared;
}

/** For shutdown, and for tests that replace the pool. */
export function closeParserPool(): void {
  shared?.close();
  shared = null;
}
