# operator-relay

> When the operator types a prompt to an ephemeral worker, this plugin forwards it to the worker's managing personai via The Wire. So you can talk to any worker on your team and the right permanent agent hears you too.

## What this gets you

- **You can talk to ephemeral workers directly** — open their screen session, type a prompt, and their managing personai gets notified
- **The managing personai stays in the loop** — it sees what you said to its workers and can intervene or coordinate
- **Zero ceremony** — install it once, register a relay per ephemeral, the rest is automatic

This is the secret sauce that turns "a bunch of agents in screen sessions" into "a team I can supervise."

## Identity model

- A **personai** is a permanent agent — its own git repo, knowledge vault, and spawn scripts; it persists across days, machines, and reboots.
- An **ephemeral** is a short-lived worker a personai spawns to parallelize one job, then soft-reaps when done.

operator-relay exists to keep a sponsoring personai in the loop on operator prompts sent to its ephemerals. The personai owns the relay; each ephemeral it spawns gets registered.

## How it works

When the operator types a prompt into an agent's session, the runtime fires a `UserPromptSubmit` hook. This plugin's hook captures the prompt and forwards it via Wire IPC (Ed25519-signed) to the agent's managing personai.

The ephemeral still receives the prompt — it's the one you're talking to. The relay just *also* notifies its manager.

Only genuine operator prompts are relayed. System-injected prompts — scheduled wakeups (`/loop`, scheduled-task fires), Wire channel deliveries, system reminders — are filtered out, so the manager isn't spammed with the runtime's own machinery.

## Quick setup

Install the plugin on the managing personai (and on each ephemeral whose session the operator will type into):

```
/plugin install operator-relay@agiterra
```

After the personai spawns an ephemeral (say `eclair`), it registers a relay for it:

```
operator_relay_start({ agent: "eclair" })
```

`notify` defaults to the caller's `AGENT_ID`, so the manager usually omits it. To forward to a different personai, pass it explicitly:

```
operator_relay_start({ agent: "eclair", notify: "brioche" })
```

Relay state lives in `~/.wire/operator-relay.json`, keyed by the ephemeral's id.

## Quick example

You spawn an ephemeral named Eclair to work on a feature; Brioche (a personai) is its manager. Brioche registers a relay: `operator_relay_start({ agent: "eclair" })`.

You open Eclair's screen and type: "Wait — switch to the v2 spec instead."

- Eclair sees the message and acts on it
- Brioche receives the same message via Wire IPC, learns the spec changed, and adjusts the broader plan

## For the agent

Tools exposed:

| Tool | What it does |
|---|---|
| `operator_relay_start` | Relay an ephemeral's operator prompts to you. Params: `agent` (required — the ephemeral's id), `notify` (optional — who to notify; defaults to your `AGENT_ID`) |
| `operator_relay_stop` | Stop forwarding. Param: `agent` (required) |
| `operator_relay_list` | Show active relay registrations |

Hooks:

- `UserPromptSubmit` — forwards genuine operator prompts to the registered manager when a relay is active; skips system-injected prompts

## Codex caveat

The Codex equivalent of this plugin (`operator-relay-codex`) loads its MCP tools, but Codex has no equivalent of CC's `UserPromptSubmit` hook — so prompts to codex workers do NOT auto-relay. For codex spawns, the worker should manually mirror significant operator directives back to its manager via `wire-ipc.send_message`.

## Reference

| Var | Default | Description |
|---|---|---|
| `WIRE_URL` | `http://localhost:9800` | Wire server base URL |
| `AGENT_ID` | (required) | This agent's identity; also the default `notify` target |
| `AGENT_PRIVATE_KEY` | (required) | Ed25519 private key for signing relayed messages |

## Concepts

- [Identity model — personai vs ephemeral](https://github.com/agiterra/handbook/blob/main/CORE.md#1-agent-identities-personai-vs-ephemeral)

## Related plugins

- [`wire`](https://github.com/agiterra/wire-claude-code) and [`wire-ipc`](https://github.com/agiterra/wire-ipc-claude-code) — required (carries the relayed messages)
- [`crew`](https://github.com/agiterra/crew-claude-code) — pairs with this for spawn-and-supervise workflows

## License

MIT.
