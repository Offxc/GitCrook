import { main } from "./cli";

main().catch((error: unknown) => {
  process.stderr.write(`gitcrook-docs: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
