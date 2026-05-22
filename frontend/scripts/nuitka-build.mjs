import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const buildScript = join(repoRoot, "backend", "nuitka-build.py");
const pythonExe = join(repoRoot, "python", "python.exe");
const outputExe = join(repoRoot, "backend", "dist", "app", "app.exe");

console.log("[nuitka-build] Starting Nuitka compilation...");

const result = spawnSync(pythonExe, [buildScript], {
  stdio: "inherit",
  cwd: repoRoot,
});

if (result.status !== 0) {
  console.error("[nuitka-build] Nuitka build failed.");
  console.error("");
  console.error("Troubleshooting:");
  console.error("  • Ensure MSVC / Visual Studio Build Tools is installed");
  console.error("    (https://visualstudio.microsoft.com/visual-cpp-build-tools/)");
  console.error("  • Run `npm run electron:nuitka` directly for detailed output");
  process.exit(result.status ?? 1);
}

console.log(`[nuitka-build] Output: ${outputExe}`);
