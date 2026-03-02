# Task List: MTG Neo4j MCP Server

> **Reference:** [../graph.md](../.github/graph.md) — full graph schema, node types, relationships, and MCP tool specifications.
> **Ingestion pipeline:** `../src/` — the separate project that populates the Neo4j database.
> **Tech stack:** TypeScript, Node.js 18+, `@modelcontextprotocol/sdk`, `neo4j-driver`, Zod, Vitest

## Relevant Files

*(Updated as files are created/modified)*

- `mtg-mcp/package.json` — Project manifest with dependencies and scripts
- `mtg-mcp/tsconfig.json` — TypeScript compiler configuration (ES2022, NodeNext)
- `mtg-mcp/src/config.ts` — Environment variable loading/validation via dotenv + Zod
- `mtg-mcp/.env.example` — Placeholder environment variables for Neo4j connection
- `mtg-mcp/src/db.ts` — Read-only Neo4j driver, session helper (`withReadSession`)
- `mtg-mcp/src/types.ts` — Shared TypeScript interfaces for tool inputs/outputs
- `mtg-mcp/src/db.test.ts` — Smoke tests verifying Neo4j connectivity and Card node reads
- `mtg-mcp/src/server.ts` — MCP server setup, tool registration, stdio transport, graceful shutdown
- `mtg-mcp/src/tools/search-cards.ts` — `search_cards` tool: general-purpose card search by name and oracle text with filters
- `mtg-mcp/src/tools/search-cards.test.ts` — Integration tests for `search_cards` tool via MCP client
- `mtg-mcp/src/tools/find-synergies.ts` — `find_synergies` tool: find cards sharing mechanic tags with a given card
- `mtg-mcp/src/tools/find-by-mechanic.ts` — `find_by_mechanic` tool: find cards by mechanic tag names or broader search terms
- `mtg-mcp/src/tools/find-synergies.test.ts` — Integration tests for `find_synergies` and `find_by_mechanic` tools

## Notes

- This MCP server is **read-only**. It queries the Neo4j database populated by the ingestion pipeline. It never writes data.
- All Cypher queries are pre-written with parameter binding. The LLM never generates Cypher.
- Transport is stdio. Diagnostic logging goes to stderr (`console.error`) so it doesn't interfere with the MCP protocol on stdout.
- The Neo4j database has ~30k Card nodes, ~200 Keyword nodes, ~300 CreatureType nodes, ~20 CardType nodes, ~4000 MechanicTag nodes, 5 Color nodes, and ~15 Format nodes.
- MechanicTags are Scryfall community tagger tags organised into 24 functional categories (card_draw, removal, ramp_mana, tokens, graveyard, counters, combat, protection, sacrifice, lifegain, damage_drain, blink_flicker, lands, tribal, discard, control_stax, enchantments, artifacts, spellslinger, tutor, politics_multiplayer, voltron, activated_abilities, cheat_costs).
- `legalities` on Card nodes is stored as a JSON string. For format filtering, prefer using `LEGAL_IN` relationship edges instead.

---

## Tasks

- [x] 1.0 Project setup and Neo4j connection
  - [x] 1.1 Initialise `package.json` with `npm init -y` inside `mtg-mcp/`. Install dependencies: `@modelcontextprotocol/sdk`, `neo4j-driver`, `dotenv`, `zod`. Dev dependencies: `typescript`, `tsx`, `vitest`, `@types/node`
  - [x] 1.2 Create `tsconfig.json` with `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"outDir": "dist"`, `"rootDir": "src"`
  - [x] 1.3 Create `src/config.ts` using `dotenv` and `zod` to load and validate: `NEO4J_URI` (default `bolt://localhost:7687`), `NEO4J_USER` (default `neo4j`), `NEO4J_PASSWORD` (default `password`)
  - [x] 1.4 Create `.env.example` with placeholder values
  - [x] 1.5 Create `src/db.ts` with a read-only Neo4j driver: `getDriver()`, `withReadSession()` (wraps `session.executeRead()`), and `closeDriver()`. No write session helper — this server is read-only
  - [x] 1.6 Create `src/types.ts` with shared TypeScript interfaces for tool inputs and outputs (e.g. `CardResult`, `ComboResult`, `SynergyResult`, `TribalResult`)
  - [x] 1.7 Add scripts to `package.json`: `"start": "tsx src/server.ts"`, `"test": "vitest"`
  - [x] 1.8 Write a smoke test that connects to Neo4j and runs a simple read query (e.g. count Card nodes)

- [x] 2.0 MCP server skeleton and first tool (`search_cards`)
  - [x] 2.1 Create `src/server.ts` that initialises an MCP server using `@modelcontextprotocol/sdk`, registers tools, and connects via stdio transport. Include graceful shutdown that closes the Neo4j driver
  - [x] 2.2 Create `src/tools/search-cards.ts` — general-purpose card search. Parameters: `query` (string, required — searches card name and oracle text via full-text index), `colors` (string[], optional — filter by color identity), `type` (string, optional — filter by card type), `cmc_max` (number, optional), `format` (string, optional, default `commander`), `limit` (number, optional, default 10, max 25). Returns matching cards with name, oracle_text, mana_cost, cmc, type_line, color_identity, and relevance score
  - [x] 2.3 Register `search_cards` as an MCP tool in `server.ts` with a clear description and Zod-validated input schema
  - [x] 2.4 Test the server manually: run it via stdio and send a `tools/list` request, then a `tools/call` for `search_cards`
  - [x] 2.5 Write tests for `search_cards` Cypher logic and parameter validation

- [x] 3.0 Synergy and mechanic discovery tools
  - [x] 3.1 Create `src/tools/find-synergies.ts` — find cards sharing mechanic tags with a given card. Parameters: `card_name` (string, required), `format` (string, optional, default `commander`), `color_identity` (string[], optional — restrict to these colors), `limit` (number, optional, default 15). Query: match the target card's `HAS_MECHANIC` tags, find other cards with the same tags, score by number of shared tags, return cards with shared tag names and synergy score
  - [x] 3.2 Create `src/tools/find-by-mechanic.ts` — find cards by mechanic tag names or category. Parameters: `tags` (string[], required — tag names or category names), `colors` (string[], optional), `cmc_max` (number, optional), `format` (string, optional, default `commander`), `limit` (number, optional, default 15). If a category name is provided (e.g. `card_draw`), match all tags in that category. Return matching cards with their matching tags
  - [x] 3.3 Register both tools in `server.ts` and write tests

- [ ] 4.0 Combo discovery tool
  - [ ] 4.1 Create `src/tools/find-combos.ts` — find known combos involving a card. Parameters: `card_name` (string, required). Query: match `COMBOS_WITH` relationships. Return combo partners with combo description and full list of cards needed
  - [ ] 4.2 Register the tool and write tests

- [ ] 5.0 Tribal support tool
  - [ ] 5.1 Create `src/tools/find-tribal.ts` — find tribal lords, payoffs, and enablers for a creature type. Parameters: `creature_type` (string, required), `color_identity` (string[], optional), `format` (string, optional, default `commander`), `limit` (number, optional, default 20). Query: match `TRIBAL_LORD_OF` edges for lords, `HAS_CREATURE_TYPE` for creatures of the type, and `PAYOFF_FOR`/`ENABLER_FOR` edges for cards that support the tribe's common mechanics. Return categorised results (lords, creatures, payoffs, enablers)
  - [ ] 5.2 Register the tool and write tests

- [ ] 6.0 Legality checking tool
  - [ ] 6.1 Create `src/tools/check-legality.ts` — validate a list of cards against format legality. Parameters: `card_names` (string[], required), `format` (string, required). Query: for each card name, check if a `LEGAL_IN` edge exists to the format. Return a results array with each card's status (legal, restricted, not legal, not found)
  - [ ] 6.2 Register the tool and write tests

- [ ] 7.0 Card detail tool
  - [ ] 7.1 Create `src/tools/get-card.ts` — get full details for a specific card. Parameters: `card_name` (string, required). Return all Card properties plus its keywords, creature types, card types, color identity, mechanic tags, and format legalities
  - [ ] 7.2 Register the tool and write tests

- [ ] 8.0 Integration testing and polish
  - [ ] 8.1 Write integration tests that run the MCP server end-to-end: start the server, send tool calls via stdio, verify responses
  - [ ] 8.2 Test tool chaining: `find_synergies` → `find_by_mechanic` → `check_legality` in sequence
  - [ ] 8.3 Add error handling for common failures: card not found, invalid format, Neo4j connection down. Each should return a clear message the LLM can understand
  - [ ] 8.4 Review all tool descriptions for clarity — these are the LLM's only documentation for deciding which tool to call
  - [ ] 8.5 Create a `README.md` with setup instructions, tool descriptions, and example usage

- [ ] 9.0 MCP client configuration
  - [ ] 9.1 Create an MCP client configuration file (e.g. for Claude Desktop or VS Code) that registers this server with the correct command (`tsx src/server.ts`) and working directory
  - [ ] 9.2 Document how to add this MCP server to different clients (Claude Desktop, VS Code Copilot, custom agents) in the README
  - [ ] 9.3 Test with at least one real LLM client to verify the tools work in practice
