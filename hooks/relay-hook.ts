/**
 * UserPromptSubmit hook: forward operator prompts to the managing agent.
 *
 * Reads the agent's relay config from ~/.wire/operator-relay.json.
 * If this agent has a relay registered, forwards the full prompt to
 * the managing agent via Wire (JWT-signed).
 *
 * Stdin: { prompt, session_id, cwd, ... }
 * Stdout: nothing (silent relay, no context injection)
 */

import { readFileSync } from "fs";
import { getRelay, forwardPrompt } from "@agiterra/operator-relay-tools";
import { importPrivateKey } from "@agiterra/wire-tools";

/**
 * Check the transcript JSONL for the most recent user record matching the
 * incoming prompt and inspect its `isMeta` field. CC marks system-injected
 * user records (ScheduleWakeup-fired prompts, skill-body injections, channel
 * deliveries, etc.) with `isMeta: true`; genuine operator prompts have it
 * absent or false. The hook stdin doesn't surface this flag in current CC
 * versions, so we read the transcript directly.
 *
 * Returns true if the most recent user record is meta (skip relay).
 * Returns false if the latest user record is genuine, or if we couldn't
 * read the transcript (fall through to existing string-marker heuristics).
 */
function isMetaUserRecord(transcriptPath: string | undefined, prompt: string): boolean {
  if (!transcriptPath) return false;
  try {
    const lines = readFileSync(transcriptPath, "utf-8").split("\n").filter((l) => l);
    // Walk backwards looking for the latest non-sidechain user record whose
    // content is a TEXT prompt (not a tool_result). The just-submitted prompt
    // should be at or near the tail.
    const head = (s: string) => s.slice(0, 200);
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec: any;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (rec.type !== "user" || rec.isSidechain) continue;

      const content = rec.message?.content;
      // Tool-result records also have type=user but content is an array of
      // tool_result entries — skip those, we only care about text prompts.
      let text: string;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        // Skip if all items are tool_result; otherwise find a text item.
        if (content.every((c: any) => c?.type === "tool_result")) continue;
        text = content.find((c: any) => c && typeof c.text === "string")?.text ?? "";
      } else {
        continue;
      }
      if (!text) continue;

      const matches = head(text).includes(head(prompt)) || head(prompt).includes(head(text));
      if (matches) return rec.isMeta === true;
      // First text user-record we hit is the most recent; if it doesn't match
      // our prompt, the transcript hasn't been updated yet — defer judgement
      // and fall through to string-marker checks rather than guessing.
      return false;
    }
  } catch {
    // Permissions, missing file, races — fall through.
  }
  return false;
}

async function main() {
  let input: { prompt?: string; transcript_path?: string; isMeta?: boolean };
  try {
    const raw = await Bun.stdin.text();
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const prompt = input.prompt ?? "";
  if (!prompt) process.exit(0);

  // Relay ONLY genuine operator prompts. Several signals catch system-
  // injected prompts that look like operator input but aren't:
  //
  // 1. transcript `isMeta: true` — CC marks ScheduleWakeup-fired prompts,
  //    skill-body injections, and channel-event deliveries with this flag.
  //    Authoritative when present. Brioche caught the wakeup-fired leak on
  //    2026-04-27 when Choux's self-scheduled wakeup body was relayed as a
  //    Tim prompt.
  // 2. Inline string markers — Wire channels, task-notifications, system-
  //    reminders, command-name expansions wrap their content in known XML
  //    tags. /loop sentinels are also matched here; the transcript-isMeta
  //    gate catches them when the hook stdin's prompt matches the stored
  //    sentinel literally, but if CC expands the sentinel before the hook
  //    fires the prompt-match falls through. The string markers below are
  //    the authoritative fallback either way. Brioche caught the /loop
  //    leak on 2026-04-29 (Choux's autonomous loop fires being relayed
  //    every iteration).
  if (input.isMeta === true) process.exit(0);
  if (isMetaUserRecord(input.transcript_path, prompt)) process.exit(0);

  const syntheticMarkers = [
    "<channel source=",
    "<channel ",
    "<task-notification",
    "<system-reminder",
    "<command-name",
    "<<autonomous-loop-dynamic>>",
    "<<autonomous-loop>>",
  ];
  if (syntheticMarkers.some((m) => prompt.includes(m))) {
    process.exit(0);
  }

  const agentId = process.env.AGENT_ID;
  if (!agentId) process.exit(0);

  const rawKey = process.env.AGENT_PRIVATE_KEY;
  if (!rawKey) process.exit(0);

  const relay = getRelay(agentId);
  if (!relay) process.exit(0);

  // Guard: never relay to self (infinite loop protection)
  if (relay.notify === agentId) {
    console.error(`[operator-relay] skipping self-relay for '${agentId}'`);
    process.exit(0);
  }

  const privateKey = await importPrivateKey(rawKey);

  try {
    await forwardPrompt({
      agentId,
      privateKey,
      notify: relay.notify,
      prompt,
    });
  } catch (e) {
    console.error(`[operator-relay] forward failed: ${e}`);
  }

  process.exit(0);
}

main();
