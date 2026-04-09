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

  const agentId = process.env.CREW_AGENT_ID;
  if (!agentId) process.exit(0);

  const rawKey = process.env.CREW_PRIVATE_KEY;
  if (!rawKey) process.exit(0);

  const relay = getRelay(agentId);
  if (!relay) process.exit(0);

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
