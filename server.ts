#!/usr/bin/env bun
import { startServer } from "@agiterra/operator-relay-tools";

startServer().catch((e) => {
  console.error("[operator-relay] fatal:", e);
  process.exit(1);
});
