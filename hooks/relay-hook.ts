/**
 * UserPromptSubmit hook: forward operator prompts to the managing agent.
 *
 * Reads the agent's relay config from ~/.wire/operator-relay.json.
 * If this agent has a relay registered, forwards the full prompt to
 * the managing agent via Wire.
 *
 * Stdin: { prompt, session_id, cwd, ... }
 * Stdout: nothing (silent relay, no context injection)
 */

import { getRelay, forwardPrompt } from "@agiterra/operator-relay-tools";

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

  // Identify this agent
  const agentId = process.env.CREW_AGENT_ID ?? process.env.AGENT_ID;
  if (!agentId) process.exit(0);

  // Check if this agent has a relay registered
  const relay = getRelay(agentId);
  if (!relay) process.exit(0);

  try {
    await forwardPrompt({
      agentId,
      notify: relay.notify,
      prompt,
    });
  } catch (e) {
    // Best effort — don't block the agent if relay fails
    console.error(`[operator-relay] forward failed: ${e}`);
  }

  process.exit(0);
}

main();
