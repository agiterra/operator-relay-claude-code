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

import { getRelay, forwardPrompt } from "@agiterra/operator-relay-tools";
import { importPrivateKey } from "@agiterra/wire-tools";

async function main() {
  let input: { prompt?: string };
  try {
    const raw = await Bun.stdin.text();
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const prompt = input.prompt ?? "";
  if (!prompt) process.exit(0);

  // Relay ONLY genuine operator prompts. Claude Code fires
  // UserPromptSubmit for several synthetic prompt sources that look like
  // operator input but aren't — skip each one explicitly:
  //
  //   <channel ...>              Wire channel message delivery (from other agents)
  //   <task-notification>        subagent / tool completion events inside the
  //                              ephemeral's own session (Stage-2 reviewer
  //                              completions, background agent wake-ups, etc.)
  //   <system-reminder>          CC's own periodic nudges
  //   <command-name>             slash-command expansions
  //
  // Brioche noticed the task-notification leak on 2026-04-17: Kouign's
  // Stage-2 reviewer completions were being relayed to her as
  // operator-prompt type, burning tokens on summarization.
  const syntheticMarkers = [
    "<channel source=",
    "<channel ",
    "<task-notification",
    "<system-reminder",
    "<command-name",
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
