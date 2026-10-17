/**
 * Run every `*.test.ts` / `*.test.mjs` file in `src` as a standalone Node script.
 *
 * The test files are plain scripts with a local `assert` helper, so no test
 * framework is needed: each file just has to exit non-zero on failure.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(full));
    else if (/\.test\.(ts|mjs|js)$/.test(entry.name)) found.push(full);
  }
  return found;
}

const files = collect(join(root, "src")).sort();
if (files.length === 0) {
  console.error("no test files found under src/");
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const label = relative(root, file).replace(/\\/g, "/");
  // `transform-types`, not `strip-types`: several modules use constructor
  // parameter properties, which strip-only mode rejects.
  const args = file.endsWith(".ts")
    ? ["--experimental-transform-types", "--no-warnings", file]
    : [file];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.status === 0) {
    console.log(`ok   ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}`);
  }
}

console.log(`\n${files.length - failed}/${files.length} test files passed`);
process.exit(failed === 0 ? 0 : 1);
