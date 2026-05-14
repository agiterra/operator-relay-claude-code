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
    //
    // ALSO check, on the way, for `system/scheduled_task_fire` records near
    // the tail — CC writes that marker BEFORE the synthetic user record for
    // /loop wakeups and ScheduleWakeup-fired prompts. If the hook fires
    // between system-record write and user-record write (the transcript
    // write race), the user record isn't visible yet but the system marker
    // is — that's a strong signal the incoming prompt is a wakeup.
    //
    // Match is intentionally EXACT (within a 500-char slice for long-prompt
    // efficiency) rather than substring-includes. Earlier `includes()`
    // heuristic over-triggered: if a prior synthetic record's text was
    // "thanks for the ack" and Tim said "thanks", `head(text).includes(prompt)`
    // returned true and the gate skipped Tim's real prompt as meta. Tim
    // reported the resulting inconsistency on 2026-04-29. Exact prefix
    // equality protects against substring collisions while still tolerating
    // CC vs hook-stdin truncation past 500 chars.
    const head = (s: string) => s.slice(0, 500);

    // Scan the last 8 records (cheap) for a scheduled_task_fire system
    // marker. If present and no genuine user record appears AFTER it, the
    // incoming prompt is the wakeup that's about to be appended.
    const TAIL_SCAN = 8;
    let sawScheduledTaskFire = false;
    let sawUserAfterScheduledTaskFire = false;
    for (let i = Math.max(0, lines.length - TAIL_SCAN); i < lines.length; i++) {
      let rec: any;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (rec.type === "system" && rec.subtype === "scheduled_task_fire") {
        sawScheduledTaskFire = true;
        sawUserAfterScheduledTaskFire = false;
      } else if (sawScheduledTaskFire && rec.type === "user" && !rec.isSidechain) {
        // Only count text user records, not tool_results.
        const c = rec.message?.content;
        const hasText = typeof c === "string"
          ? !!c
          : Array.isArray(c) && c.some((x: any) => x && typeof x.text === "string");
        if (hasText) sawUserAfterScheduledTaskFire = true;
      }
    }
    if (sawScheduledTaskFire && !sawUserAfterScheduledTaskFire) {
      // Scheduled-task fire marker is at the tail with no user record after
      // it yet — the upcoming prompt is the synthetic wakeup. Skip relay.
      return true;
    }

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

      if (head(text) === head(prompt)) return rec.isMeta === true;
      // First text user-record we hit is the most recent; if it doesn't
      // exact-match our prompt, the transcript hasn't been updated yet OR
      // we hit an unrelated prior record. Fall through to string-marker
      // checks rather than guessing isMeta.
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
