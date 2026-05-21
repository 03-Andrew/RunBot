const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const sourceNodeModules = path.join(root, "node_modules");
const distNodeModules = path.join(dist, "node_modules");

fs.rmSync(path.join(dist, "function.zip"), { force: true });
fs.rmSync(distNodeModules, { recursive: true, force: true });

const result = spawnSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  cwd: root,
  encoding: "utf8",
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

for (const dependencyPath of result.stdout.trim().split(/\r?\n/)) {
  if (!dependencyPath || dependencyPath === root) {
    continue;
  }

  const relativePath = path.relative(sourceNodeModules, dependencyPath);
  if (relativePath.startsWith("..")) {
    continue;
  }

  const targetPath = path.join(distNodeModules, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(dependencyPath, targetPath, {
    recursive: true,
    force: true,
    dereference: true,
  });
}
