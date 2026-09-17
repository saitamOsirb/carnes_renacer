import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const buildIdPath = ".next/BUILD_ID";
const fingerprintPath = ".next/.source-fingerprint";
const fingerprintRoots = ["src", "prisma"];
const fingerprintFiles = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "middleware.ts",
  "tsconfig.json",
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".sql", ".prisma"]);

function collectFiles(path) {
  if (!existsSync(path)) return [];

  const stats = statSync(path);
  if (stats.isFile()) return [path];

  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) return collectFiles(child);
      if (!entry.isFile()) return [];
      return sourceExtensions.has(extname(entry.name).toLowerCase()) ? [child] : [];
    });
}

function calculateFingerprint() {
  const hash = createHash("sha256");
  const files = [
    ...fingerprintFiles.filter((file) => existsSync(file)),
    ...fingerprintRoots.flatMap((root) => collectFiles(root)),
  ].sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    hash.update(relative(process.cwd(), file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }

  const publicEnv = Object.entries(process.env)
    .filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [key, value] of publicEnv) {
    hash.update(`${key}=${value ?? ""}\0`);
  }

  return hash.digest("hex");
}

function readPreviousFingerprint() {
  if (!existsSync(fingerprintPath)) return "";
  try {
    return readFileSync(fingerprintPath, "utf8").trim();
  } catch {
    return "";
  }
}

const currentFingerprint = calculateFingerprint();
const previousFingerprint = readPreviousFingerprint();
const hasBuild = existsSync(buildIdPath);

if (hasBuild && previousFingerprint === currentFingerprint) {
  process.exit(0);
}

if (!hasBuild) {
  console.warn("[startup] No production build found in .next. Building before starting Next.js...");
} else if (!previousFingerprint) {
  console.warn("[startup] Existing .next build has no source fingerprint. Rebuilding to avoid serving a stale bundle...");
} else {
  console.warn("[startup] Application source or NEXT_PUBLIC_* configuration changed. Rebuilding .next before startup...");
}

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

writeFileSync(fingerprintPath, `${currentFingerprint}\n`, "utf8");
