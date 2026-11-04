// Builds the two committed bundles. OpenChamber installs this package from
// Git without building it, so status/main.js and service/main.js are checked in.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const targets = [
  // Sandboxed iframes cannot load ES modules: one classic IIFE each.
  { entry: 'status/main.ts', out: 'status/main.js', node: false },
  // The service runs under Node; built-ins stay external.
  { entry: 'service/main.ts', out: 'service/main.js', node: true },
];

for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [resolve(target.entry)],
    format: target.node ? 'esm' : 'iife',
    target: target.node ? 'node' : 'browser',
    minify: !target.node,
  });
  const artifact = result.outputs[0];
  if (!result.success || !artifact) {
    console.error(result.logs.map((log) => log.message).join('\n') || `Build failed: ${target.entry}`);
    process.exit(1);
  }
  await writeFile(resolve(target.out), await artifact.text());
  console.log(`${target.out}  ${(artifact.size / 1024).toFixed(1)} KB`);
}
