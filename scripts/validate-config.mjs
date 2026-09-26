#!/usr/bin/env node
// Validate the effective config (built-in defaults + data/config.json). `--show` prints it.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, validateConfig } from "./lib/config.mjs";

const CONFIG = new URL("../data/config.json", import.meta.url);

export function checkConfig({ show = false } = {}, io = console) {
  const raw = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf8")) : {};
  const cfg = loadConfig(raw, { env: process.env });
  const { errors, warnings } = validateConfig(cfg);

  if (show) {
    io.log(JSON.stringify(cfg, null, 2));
    return errors.length ? 1 : 0;
  }
  for (const warning of warnings) io.log(`warn  ${warning}`);
  for (const error of errors) io.error(`error ${error}`);
  if (errors.length) {
    io.error(`\nconfig invalid — ${errors.length} error(s), ${warnings.length} warning(s)`);
    return 1;
  }
  const location = cfg.location.country ?? "(unset)";
  const pay = cfg.pay.enabled === false ? "off" : `${cfg.pay.currency}, floor ${cfg.pay.floorAnnual}/yr`;
  io.log(`config OK — ${location}, pay ${pay}, ${warnings.length} warning(s)`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = checkConfig({ show: process.argv.includes("--show") });
}
