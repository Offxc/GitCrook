import { chromium, type Browser } from "playwright-core";
import { getEnv } from "@voiddocs/shared/server";

export async function launchBrowser(): Promise<Browser> {
  const executablePath = getEnv().CHROMIUM_EXECUTABLE_PATH;
  return chromium.launch({
    executablePath, // undefined -> playwright-core's own discovery (a prior `playwright install chromium`); set in Docker/local .env otherwise
    headless: true,
    args: ["--no-sandbox"], // containers rarely have the userns permissions Chromium's own sandbox wants; the OS-level container boundary is the real sandbox here
  });
}
