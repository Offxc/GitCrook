// The parser thread's entry point. It is plain JavaScript so a thread can start it whatever the parent was run with:
// it registers the TypeScript loader itself, then loads the real worker. (Under `tsx` the parent has a loader of its
// own, but the thread does not inherit it; under a test runner there is none at all.)
import { register } from "tsx/esm/api";

register();
await import("./worker.ts");
