# operator-relay

> When you type a prompt to an ephemeral agent, this plugin forwards it to the agent's manager via Wire. So you can talk to any agent on your team and the right person hears you.

## What this gets you

- **You can talk to ephemeral engineers directly** — open their screen session, type a prompt, and their managing personai gets notified
- **Managing personai stays in the loop** — they see what you said to their team and can intervene or coordinate
- **Zero ceremony** — install it on the ephemeral, register the relay once, the rest is automatic

This is the secret sauce that turns "a bunch of agents in screen sessions" into "a team I can supervise."

## How it works

When an operator types a prompt into an agent's session, Claude Code fires a `UserPromptSubmit` hook. This plugin's hook captures the prompt and forwards it via Wire IPC to the agent's managing personai.

The ephemeral agent still receives the prompt — they're the one you're talking to. The relay just *also* notifies their manager.

## Quick setup

For your ephemeral agent:

```
/plugin install operator-relay@agiterra
```

Then ask the ephemeral:

> "Register an operator relay so my prompts get forwarded to <manager-name>."

The ephemeral calls `operator_relay_start({manager_id: '<manager-name>'})` and the relay is active.

## Quick example

You spawn an engineer named Eclair to work on a feature, with Brioche as her manager. You install operator-relay on Eclair. Brioche registers the relay for her.

You open Eclair's screen and type: "Wait — switch to the v2 spec instead."

- Eclair sees the message and acts on it
- Brioche receives the same message via Wire IPC, learns the spec changed, and adjusts the broader plan

## For the agent

Tools exposed:

| Tool | What it does |
|---|---|
| `operator_relay_start` | Register a manager to forward this agent's operator prompts to |
| `operator_relay_stop` | Stop forwarding |
| `operator_relay_list` | Show active relay registrations |

Hooks:

- `UserPromptSubmit` — forwards operator prompts to the registered manager when a relay is active

## Codex caveat

The Codex equivalent of this plugin (`operator-relay-codex`) loads its MCP tools, but Codex has no equivalent of CC's `UserPromptSubmit` hook — so prompts to codex engineers do NOT auto-relay. For codex spawns, engineers should manually mirror significant operator directives back to their manager via `wire-ipc.send_message`.

## Reference

| Var | Default | Description |
|---|---|---|
| `WIRE_URL` | `http://localhost:9800` | Wire server base URL |
| `AGENT_ID` | (required) | This agent's identity |
| `AGENT_PRIVATE_KEY` | (required) | Ed25519 private key for signing |

## Concepts

- [Identity model — personai vs ephemeral](https://github.com/agiterra/handbook/blob/main/CORE.md#1-agent-identities-personai-vs-ephemeral)

## Related plugins

- [`wire`](https://github.com/agiterra/wire-claude-code) and [`wire-ipc`](https://github.com/agiterra/wire-ipc-claude-code) — required (carries the relayed messages)
- [`crew`](https://github.com/agiterra/crew-claude-code) — pairs with this for spawn-and-supervise workflows

## License

MIT.
