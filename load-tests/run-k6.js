import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node load-tests/run-k6.js <k6-args...>");
  process.exit(1);
}

function resolveK6Binary() {
  const probe = spawnSync("k6", ["version"], { stdio: "ignore", shell: false });
  if (probe.status === 0) {
    return "k6";
  }

  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "k6", "k6.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "k6", "k6.exe"),
      path.join(process.env.USERPROFILE || "", "scoop", "shims", "k6.exe"),
    ];
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  console.error(
    "k6 CLI not found. Install it via `winget install GrafanaLabs.k6` (Windows) or `brew install k6` (macOS)."
  );
  process.exit(1);
}

const k6Bin = resolveK6Binary();
const result = spawnSync(k6Bin, args, { stdio: "inherit", shell: false });

if (result.error) {
  console.error("Failed to run k6:", result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
