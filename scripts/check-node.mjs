import { readFileSync } from "node:fs";

const minimum = readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim();
const required = minimum.split(".").map(Number);
const actual = process.versions.node.split(".").map(Number);
const atLeastMinimum = actual[1] > required[1] ||
  (actual[1] === required[1] && actual[2] >= required[2]);

if (actual[0] !== required[0] || !atLeastMinimum) {
  console.error(
    `Node.js ${process.versions.node} desteklenmiyor. ${minimum} veya daha yeni bir ${required[0]}.x güvenlik sürümü gerekiyor.\n` +
    "Uygulama klasöründe nvm install && nvm use çalıştırın.",
  );
  process.exit(1);
}
