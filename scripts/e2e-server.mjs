#!/usr/bin/env node
// `next build` with a custom NEXT_DIST_DIR (used so the e2e production build never
// clobbers the `next dev` output in .next/) rewrites two tracked files -
// next-env.d.ts and tsconfig.json - so their route-type references point at the
// custom dist dir's `types/` folder instead of `.next/types/`. That's normal Next.js
// behavior for any non-default distDir, but it leaves the working tree dirty after
// every e2e run. This wrapper snapshots both files before the build, lets Next
// rewrite them as it needs to during the build, then restores the originals before
// starting the server - so the repo is clean again by the time tests run against it.

import { spawnSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const FILES = ["next-env.d.ts", "tsconfig.json"];

const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_DIST_DIR: ".next-e2e",
};

function snapshot(files) {
  return files.map((file) => {
    const abs = path.resolve(process.cwd(), file);
    if (existsSync(abs)) {
      return { file, abs, existed: true, contents: readFileSync(abs) };
    }
    return { file, abs, existed: false, contents: null };
  });
}

function restore(snapshots) {
  for (const snap of snapshots) {
    if (snap.existed) {
      writeFileSync(snap.abs, snap.contents);
    } else if (existsSync(snap.abs)) {
      unlinkSync(snap.abs);
    }
  }
}

const snapshots = snapshot(FILES);

const build = spawnSync(npx, ["next", "build"], {
  stdio: "inherit",
  env,
  shell: isWin,
});

if (build.status !== 0) {
  restore(snapshots);
  process.exit(build.status ?? 1);
}

restore(snapshots);

const server = spawn(npx, ["next", "start", "-p", "3100"], {
  stdio: "inherit",
  env,
  shell: isWin,
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    server.kill(sig);
  });
}

server.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
