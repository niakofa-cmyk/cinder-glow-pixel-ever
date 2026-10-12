import { resolve, relative, isAbsolute } from "node:path";
import { SCENARIOS } from "./scenarios.mjs";

export function parseOptions(args) {
  const options = { duration: 5, warmup: 1, repeats: 3, rates: [48000, 96000],
    block: 128, soak: 300, changeEvery: 5, scenarios: [...SCENARIOS], output: null };
  const names = {
    duration: "duration", warmup: "warmup", repeats: "repeats", block: "block",
    soak: "soak", "change-every": "changeEvery",
  };
  const seen = new Set();
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || seen.has(match[1])) throw new Error(`Invalid or repeated benchmark option: ${arg}`);
    const [, key, value] = match;
    seen.add(key);
    if (Object.hasOwn(names, key)) options[names[key]] = Number(value);
    else if (key === "rates") options.rates = value.split(",").map(Number);
    else if (key === "scenarios") options.scenarios = value.split(",");
    else if (key === "output") options.output = value;
    else throw new Error(`Unknown benchmark option: ${key}`);
  }
  const range = (name, min, max, integer = false) => {
    const value = options[name];
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      throw new Error(`${name} must be ${integer ? "an integer " : ""}between ${min} and ${max}.`);
  };
  range("duration", 0.05, 60); range("warmup", 0, 10); range("repeats", 1, 10, true);
  range("block", 32, 4096, true); range("soak", 0, 3600); range("changeEvery", 0.05, 60);
  if (!options.rates.length || options.rates.length > 4 ||
      options.rates.some(r => !Number.isInteger(r) || r < 8000 || r > 192000) ||
      new Set(options.rates).size !== options.rates.length)
    throw new Error("Choose 1–4 distinct integer sample rates between 8000 and 192000.");
  if (!options.scenarios.length || options.scenarios.some(s => !SCENARIOS.includes(s)) ||
      new Set(options.scenarios).size !== options.scenarios.length)
    throw new Error(`Choose distinct scenarios from: ${SCENARIOS.join(", ")}.`);
  if (options.output) options.output = outputPath(options.output);
  return options;
}

export function outputPath(path) {
  const root = resolve("generated-artifacts/benchmarks");
  const destination = resolve(path);
  const inside = relative(root, destination);
  if (!inside || inside.startsWith("..") || isAbsolute(inside) || !destination.endsWith(".json"))
    throw new Error("Output must be a JSON file inside generated-artifacts/benchmarks/.");
  return destination;
}
