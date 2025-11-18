import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const interfacesDir = "@pendle/boros-core/artifacts/contracts/interfaces";
const abis: Record<string, string> = {
  IRouter: "RouterAbi",
};

const outDir = join(__dirname, "../abis");
mkdirSync(outDir, { recursive: true });

for (const [contract, name] of Object.entries(abis)) {
  const { abi } = JSON.parse(
    readFileSync(
      require.resolve(`${interfacesDir}/${contract}.sol/${contract}.json`),
      "utf8"
    )
  );
  writeFileSync(
    join(outDir, `${name}.ts`),
    `export const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n`
  );
}

console.log(`Generated ${Object.keys(abis).length} abis`);
