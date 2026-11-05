import { cp, mkdir, readdir, writeFile, rm } from "node:fs/promises";
await mkdir("dist/apps/web/assets", { recursive: true });
await cp("LICENSE", "dist/LICENSE");
await cp("apps/web/index.html", "dist/apps/web/index.html");
await cp("packages/ui/theme.css", "dist/apps/web/assets/theme.css");
await cp(
  "packages/ui/architecture.svg",
  "dist/apps/web/assets/architecture.svg",
);
await cp("dist/apps/web/main.js", "dist/apps/web/assets/main.js");
await mkdir("dist/packages/storage", { recursive: true });
for (const file of await readdir("packages/storage"))
  if (file.endsWith(".sql"))
    await cp(`packages/storage/${file}`, `dist/packages/storage/${file}`);
console.log("Built portable server + web assets.");

for (const [family, files] of Object.entries({
  inter: ["inter-latin-400-normal.woff2", "inter-latin-600-normal.woff2"],
  "cormorant-garamond": ["cormorant-garamond-latin-400-normal.woff2"],
  "jetbrains-mono": ["jetbrains-mono-latin-400-normal.woff2"],
})) {
  for (const file of files)
    await cp(
      `node_modules/@fontsource/${family}/files/${file}`,
      `dist/apps/web/assets/${file}`,
    );
  await mkdir("dist/licenses", { recursive: true });
  await cp(
    `node_modules/@fontsource/${family}/LICENSE`,
    `dist/licenses/${family}.txt`,
  );
}

await writeFile(
  "dist/package.json",
  JSON.stringify(
    {
      license: "AGPL-3.0-only",
      type: "module",
      private: true,
      engines: { node: ">=24.22.1 <25" },
    },
    null,
    2,
  ),
);
await rm("dist/tests", { recursive: true, force: true });
