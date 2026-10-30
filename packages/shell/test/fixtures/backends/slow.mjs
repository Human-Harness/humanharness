// A test backend that reads every call and never answers.
import { createInterface } from "node:readline";

createInterface({ input: process.stdin }).on("line", () => {});
