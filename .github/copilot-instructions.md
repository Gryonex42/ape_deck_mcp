# Copilot Instructions — MTG Neo4j MCP Server

## Project Context

This is a Model Context Protocol (MCP) server that sits in front of a Neo4j graph database containing Magic: The Gathering card data. It exposes structured tools that an LLM client (Claude, Copilot, or a custom agent) can call to discover card synergies, build decks, find combos, and search the card database — without ever writing raw Cypher.

The Neo4j database is populated by a separate ingestion pipeline (`../src/`). This project only **reads** from the database. It never writes to it.

The full graph schema is documented in `../.github/graph.md`.

### Tech Stack

- **Language:** TypeScript (everything)
- **Runtime:** Node.js 18+
- **MCP SDK:** `@modelcontextprotocol/sdk` (official Model Context Protocol SDK)
- **Database:** Neo4j 5.x via `neo4j-driver` (read-only access)
- **Config validation:** Zod + dotenv
- **Testing:** Vitest
- **Transport:** stdio (standard MCP transport for local tools)
- **Execution:** `tsx` (run TypeScript directly, no build step for dev)

### What This Project Is NOT

- Not a web app or REST API. It's an MCP server communicating over stdio.
- Not the data ingestion pipeline. It reads from Neo4j, never writes.
- Not using Express, Fastify, or any web framework.
- Not using Python. Everything is TypeScript.
- Not generating Cypher dynamically from LLM input. All Cypher is pre-written and parameterised.

---

## Neo4j Graph Schema (Read-Only)

The MCP server reads from a graph with these node types and relationships. Do not create nodes or relationships — only query them.

### Node Types

| Label | Key Property | Notes |
|---|---|---|
| `Card` | `oracle_id` (unique) | Core node. Properties: `name`, `oracle_text`, `mana_cost`, `cmc`, `type_line`, `colors`, `color_identity`, `power`, `toughness`, `loyalty`, `keywords`, `rarity`, `set_code`, `legalities` (JSON string), `edhrec_rank`, `produced_mana`, `image_uri` |
| `Keyword` | `name` (unique) | Flying, Trample, Flashback, etc. |
| `CreatureType` | `name` (unique) | Zombie, Elf, Dragon, etc. |
| `CardType` | `name` (unique) | Creature, Instant, Sorcery, Enchantment, Artifact, Planeswalker, Land, Legendary, etc. |
| `MechanicTag` | `name` (unique) | Tagger-derived functional tags from Scryfall's community tagger (e.g. `spot removal`, `mana dork`, `board wipe`, `card draw`). ~4000+ tags organised into 24 functional categories. |
| `Color` | `name` (unique) | `W`, `U`, `B`, `R`, `G` |
| `Format` | `name` (unique) | `standard`, `modern`, `commander`, `legacy`, etc. |

### Relationships

| Type | From → To | Properties | Notes |
|---|---|---|---|
| `HAS_KEYWORD` | Card → Keyword | | |
| `HAS_CREATURE_TYPE` | Card → CreatureType | | |
| `HAS_CARD_TYPE` | Card → CardType | | |
| `HAS_COLOR` | Card → Color | | Card's colors |
| `HAS_COLOR_IDENTITY` | Card → Color | | Commander color identity |
| `HAS_MECHANIC` | Card → MechanicTag | | What the card functionally does (LLM-classified) |
| `LEGAL_IN` | Card → Format | `status: "legal" \| "restricted"` | Only legal/restricted cards have edges |
| `PRODUCES_MANA_FOR` | Card → Color | | Mana production |
| `TRIBAL_LORD_OF` | Card → CreatureType | `buff: string` | Lords / tribal payoffs |
| `PAYOFF_FOR` | Card → MechanicTag | | Card rewards doing the tagged thing |
| `ENABLER_FOR` | Card → MechanicTag | | Card enables the tagged mechanic |

### Important Data Quirks

- **`legalities` is a JSON string**, not a Neo4j map. Parse it with `JSON.parse()` when needed. For format-filtering, prefer using `LEGAL_IN` relationships instead.
- **`colors` and `color_identity` are arrays** stored as Neo4j lists on the Card node.
- **`edhrec_rank`** is nullable — not all cards have one. Lower rank = more popular.
- **`oracle_text`** is nullable — vanilla creatures and basic lands have empty text.
- **MechanicTags are community tagger tags**, not the 26 hardcoded mechanic tags from the original graph.md spec. They are organised into 24 functional categories (card_draw, removal, ramp_mana, tokens, graveyard, counters, combat, protection, sacrifice, lifegain, damage_drain, blink_flicker, lands, tribal, discard, control_stax, enchantments, artifacts, spellslinger, tutor, politics_multiplayer, voltron, activated_abilities, cheat_costs).

---

## Core Principles

**Read-only.** This server never modifies the database. Every query uses `session.executeRead()`.

**Pre-written Cypher only.** All Cypher queries are written by developers at implementation time. The LLM never generates or injects Cypher. Queries use `$parameter` binding for all user-supplied values.

**Controlled result sizes.** Every tool caps results with `LIMIT`. Never return unbounded result sets. Default limits should be sensible (10–25 results), with an optional `limit` parameter the LLM can adjust.

**Composable tools.** Design tools to do one thing well so the LLM can chain them. `find_synergies` → `find_combos` → `check_legality` is a natural flow.

**Format-aware defaults.** Default to Commander format filtering since that's the primary deck-building use case. Always accept an optional `format` parameter to override.

---

## Code Quality

- Write clear, direct TypeScript. Naming matters more than comments.
- Handle errors explicitly. Return a structured error message the LLM can understand — don't throw raw exceptions.
- Use native `fetch`, native `fs/promises`, native `path`. Don't add libraries for things Node.js can do.
- No premature optimisation. Write correct, readable Cypher first.
- Tests should verify tool behaviour end-to-end: given these parameters, expect these results.
- Use Zod for input validation on tool parameters. MCP tools receive untrusted input from the LLM.

## Architecture

- Keep it flat. One file per tool (or group of related tools) plus shared db/config modules.
- All Cypher lives in the tool files, not in a separate "queries" layer.
- Don't build abstraction layers over Neo4j. The `neo4j-driver` API is already clean.
- Each tool function should: validate input → run Cypher → format results → return.

## Communication

- Be direct. Say what a tool does and why, in plain language.
- Tool descriptions are critical — they're how the LLM decides which tool to call. Make them precise and action-oriented.
- If a tool's result set is empty, return an informative message ("No cards found matching…") rather than an empty array.

## What Not To Do

- Don't write to the database. No `CREATE`, `MERGE`, `SET`, or `DELETE` in any Cypher query.
- Don't generate Cypher dynamically from LLM input. All queries are static templates with parameter binding.
- Don't return raw Neo4j records. Transform them into clean objects with only the fields the LLM needs.
- Don't return 50+ results. Cap everything. The LLM's context window is finite.
- Don't add a web framework. This is stdio-based MCP.
- Don't use `any`. Use proper TypeScript types.
- Don't add logging frameworks. Use `console.error` for diagnostic output (stderr, so it doesn't interfere with stdio MCP transport).
- Don't add a build step for dev. Use `tsx` to run TypeScript directly.

---

## Project Structure

```
mtg-mcp/
  package.json
  tsconfig.json
  .env.example
  copilot-instructions.md
  tasks.md
  src/
    server.ts              MCP server setup, tool registration, stdio transport
    config.ts              Env vars (NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD) via Zod
    db.ts                  Neo4j driver (read-only), session helper
    types.ts               Shared TypeScript types for tool inputs/outputs
    tools/
      find-synergies.ts    Find cards sharing mechanics/tags with a given card
      find-combos.ts       Find known combos involving a card
      find-tribal.ts       Lords, payoffs, enablers for a creature type
      find-by-mechanic.ts  Find cards matching mechanic tags or categories
      build-shell.ts       Generate a starter deck shell for a commander
      search-cards.ts      General-purpose filtered card search
      check-legality.ts    Validate card names against format legality
    tools.test.ts          Tests for tool logic (mocked Neo4j or real instance)
```

Keep this structure. The `tools/` directory is the one place where splitting into multiple files makes sense — each tool is a self-contained unit with its own Cypher queries.

### Neo4j Patterns (Read-Only)

- Use `session.executeRead()` for all queries. Never `executeWrite()`.
- Use `$parameterName` syntax for all user-supplied values. Never interpolate strings into Cypher.
- Keep Cypher readable — multi-line template literals, not string concatenation.
- Use `OPTIONAL MATCH` when a relationship might not exist (e.g. a card might not have `COMBOS_WITH` edges).
- For full-text search on oracle_text, use `CALL db.index.fulltext.queryNodes('card_oracle_text', $query)`.
- Always include `LIMIT $limit` on result-returning queries.

### MCP Tool Design

- Each tool is an async function that takes validated parameters and returns a structured result.
- Tool names should be verb-noun: `find_synergies`, `search_cards`, `check_legality`.
- Tool descriptions must be clear enough that an LLM can decide when to call them without ambiguity.
- Input parameters use Zod schemas for validation before hitting Neo4j.
- Return plain objects (not Neo4j Records). Include only fields useful to the LLM: card name, oracle text, mana cost, why it's relevant.
- If a tool returns cards, always include `name`, `oracle_text`, and `mana_cost` at minimum — the LLM needs these to reason about the card.

### Testing

- Use Vitest. Test files live next to source files or in a shared test file.
- Test each tool's Cypher logic with known card names from the database.
- Mock Neo4j for unit tests. Use the real database for integration tests.
- Test edge cases: card not found, empty results, invalid format name, color identity filtering.

---

## Task List Management

The task list lives in `tasks.md`. A shared memory file lives in `memory.md` — use it to record important context, decisions, gotchas, or anything that future tasks might need. Follow these rules when working through tasks.

### Task Implementation

- **One sub-task at a time.** Do **NOT** start the next sub-task until you ask the user for permission and they say "yes" or "y".
- **Completion protocol:**
  1. When you finish a **sub-task**, immediately mark it as completed by changing `[ ]` to `[x]`.
  2. If **all** sub-tasks underneath a parent task are now `[x]`, follow this sequence:
     - **First:** Run the full test suite (`npx vitest run`).
     - **Only if all tests pass:** Stage changes (`git add .`).
     - **Clean up:** Remove any temporary files and temporary code before committing.
     - **Commit:** Use a descriptive commit message that:
       - Uses conventional commit format (`feat:`, `fix:`, `refactor:`, etc.)
       - Summarises what was accomplished in the parent task
       - Lists key changes and additions
       - References the task number
       - Formats the message as a single-line command using `-m` flags, e.g.:
         ```
         git commit -m "feat: add find_synergies MCP tool" -m "- Shared mechanics query" -m "- Color identity filtering" -m "- Task 2.0"
         ```
  3. Once all sub-tasks are marked completed and changes have been committed, mark the **parent task** as completed.
- Stop after each sub-task and wait for the user's go-ahead.

### Task List Maintenance

1. **Update the task list as you work:** Mark tasks and sub-tasks as completed (`[x]`) per the protocol above. Add new tasks as they emerge.
2. **Maintain the "Relevant Files" section:** List every file created or modified. Give each file a one-line description of its purpose.

### AI Instructions

When working with the task list, you must:

1. Regularly update `tasks.md` after finishing any significant work.
2. Follow the completion protocol: mark each finished **sub-task** `[x]`, mark the **parent task** `[x]` once all its sub-tasks are `[x]`.
3. Add newly discovered tasks.
4. Keep "Relevant Files" accurate and up to date.
5. Before starting work, **read `memory.md`** first, then check which sub-task is next.
6. After implementing a sub-task, update the task file and then pause for user approval.
7. If you discover anything that would be useful for future tasks — edge cases, non-obvious decisions, environment quirks, workarounds — write it to `memory.md` before pausing.
