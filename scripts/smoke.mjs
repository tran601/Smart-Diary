import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import process from "process";

const electronMain = path.join(process.cwd(), "electron", "dist", "main.js");
if (!fs.existsSync(electronMain)) {
  console.error("electron/dist/main.js not found. Run `npm run build:electron` first.");
  process.exit(1);
}

const binName = process.platform === "win32" ? "electron.cmd" : "electron";
const electronPath = path.join(process.cwd(), "node_modules", ".bin", binName);

const child = spawn(electronPath, ["."], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    SMART_DIARY_SMOKE: "1"
  }
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
