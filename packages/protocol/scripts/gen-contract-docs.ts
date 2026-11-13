import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderContract } from "../test/contract-docs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
fs.writeFileSync(path.join(root, "docs/architecture/contract.md"), renderContract(root));
