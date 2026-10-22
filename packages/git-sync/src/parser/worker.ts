import { parentPort } from "node:worker_threads";
import { parseMarkdown } from "@gitcrook/markdown";

/**
 * The inside of the parser thread (see pool.ts). It does one thing: parse the text it is given and say which includes it
 * would have followed if it had them. It holds no state between requests.
 */
if (!parentPort) throw new Error("This file runs as a worker thread.");
const port = parentPort;

interface Request {
  id: number;
  text: string;
  options: { path?: string; idSeed?: string };
  /** Include targets (as written in the tag) → the text they stand for. */
  includes: Record<string, string>;
}

port.on("message", (request: Request) => {
  const wanted = new Set<string>();
  try {
    const result = parseMarkdown(request.text, {
      ...request.options,
      resolveInclude: (target) => {
        const text = request.includes[target];
        if (text === undefined) {
          wanted.add(target);
          return null;
        }
        return text;
      },
    });
    port.postMessage({ id: request.id, ok: true, result, wanted: [...wanted] });
  } catch (error) {
    port.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

port.postMessage({ ready: true });
