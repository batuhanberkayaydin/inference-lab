import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve("public/pdfjs");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const folder of ["cmaps", "iccs", "standard_fonts", "wasm"]) {
  cpSync(resolve("node_modules/pdfjs-dist", folder), resolve(target, folder), { recursive: true });
}
cpSync(resolve("node_modules/pdfjs-dist/LICENSE"), resolve(target, "LICENSE"));
