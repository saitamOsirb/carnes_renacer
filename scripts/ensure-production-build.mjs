import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const buildIdPath = ".next/BUILD_ID";

if (existsSync(buildIdPath)) {
  process.exit(0);
}

console.warn("[startup] No production build found in .next. Running the production build before starting Next.js...");

const npmExecPath = process.env.npm_execpath;
let result;

if (npmExecPath) {
  result = spawnSync(process.execPath, [npmExecPath, "run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
} else {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  result = spawnSync(command, ["run", "build"], {
    stdio: "inherit",
    env: process.env,
  });
}

if (result.error) {
  console.error("[startup] Failed to launch the production build:", result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!existsSync(buildIdPath)) {
  console.error("[startup] The build command completed but .next/BUILD_ID was not created.");
  process.exit(1);
}
