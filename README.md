# operator-relay-claude-code

Operator relay — forwards operator prompts on ephemeral agents to their managing agents via Wire.

## Prerequisites

- Wire server running (default: `localhost:9800`)
- Bun (https://bun.sh)

## Install

```
/plugin install agiterra/operator-relay-claude-code
```

## Tools / Skills

**MCP tools:**
- `operator_relay_start` — register a relay so this agent's operator prompts are forwarded to a managing agent
- `operator_relay_stop` — deregister the relay
- `operator_relay_list` — list active relay registrations

**Hooks:**
- `UserPromptSubmit` — automatically forwards operator prompts to the registered managing agent when a relay is active

## Configuration

| Var | Default | Description |
|-----|---------|-------------|
| `WIRE_URL` | `http://localhost:9800` | Wire server base URL |
| `CREW_AGENT_ID` | — | This agent's identity (required) |
| `CREW_PRIVATE_KEY` | — | Ed25519 private key for signing outbound messages (required) |
