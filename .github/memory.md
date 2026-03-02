# Memory

## Environment

- Neo4j database has 31,673 Card nodes as of initial smoke test.
- dotenv v17.3.1 prints an info line to stdout when injecting env vars — this is cosmetic and won't interfere with stdio MCP transport since MCP reads JSON-RPC messages, not raw lines. But worth noting if stdout parsing ever seems noisy.
- Zod v4.3.6 is installed (Zod 4.x, not 3.x) — API is compatible but worth keeping in mind for schema syntax.
- `package.json` uses `"type": "module"` for ESM. All local imports use `.js` extensions (required by NodeNext resolution).

## Decisions

- `db.ts` uses a singleton driver pattern (`getDriver()` lazily creates the driver). This keeps it simple for an MCP server that runs as a single process.
- `withReadSession()` opens a session, runs the work function inside `executeRead()`, and closes the session. Each tool call gets its own session.
- `search_cards` uses two separate queries (full-text oracle search + name CONTAINS), then merges/deduplicates client-side. This avoids UNION complications with Neo4j full-text index procedures.
- Neo4j integer values (LIMIT, cmc_max) must use `neo4j.int()` — plain JS numbers get sent as floats which Neo4j rejects for integer-only contexts.
- MCP SDK v1.27.1 supports both Zod 3 and Zod 4 via `zod-compat.ts`. Our Zod 4 schemas work directly with `server.tool()` / `server.registerTool()`.
- Tool registration uses the deprecated `server.tool()` overloads which still work fine. The newer `server.registerTool()` API is also available.
- Full-text index `card_oracle_text` exists on `Card.oracle_text` only (not name). Name search uses `toLower(c.name) CONTAINS toLower($query)`.
- Lucene query sanitisation: escape special chars and append `*` to each word for prefix matching, joined with `AND`.

## MechanicTag Data (Task 3.0)

- MechanicTag nodes have only a `name` property — no `category` property exists.
- There are 198 MechanicTag nodes total (not 4000+ as originally estimated).
- Only ~125 cards have `HAS_MECHANIC` relationships. Most cards in the DB are untagged.
- Tags are flat descriptive names like `removal-exile`, `mana dork`, `draw engine`, `ramp`, `sacrifice outlet-creature`.
- The 24 "functional categories" from the spec are conceptual groupings, not stored in the DB. Using CONTAINS matching on tag names works as a practical substitute (e.g., searching "removal" matches `removal-exile`, `removal-creature`, `removal-destroy`, etc.).
- ENABLER_FOR has 25 edges, PAYOFF_FOR has 2 edges — both very sparse.
- Most-tagged card: Wail of the Nim (5 tags). Max tags per card is around 4-5.
- `find_synergies` returns "no mechanic tags" for untagged cards and "not found" for missing cards (distinguished via a `found` boolean).
- Sol Ring and Lightning Bolt have no HAS_MECHANIC relationships.

## Combo Tool Data (Task 4.0)

- No `COMBOS_WITH` relationship exists in the Neo4j database. All relationship types: HAS_COLOR, HAS_COLOR_IDENTITY, HAS_KEYWORD, HAS_CREATURE_TYPE, HAS_CARD_TYPE, LEGAL_IN, PRODUCES_MANA_FOR, TRIBAL_LORD_OF, PAYOFF_FOR, ENABLER_FOR, HAS_MECHANIC.
- ENABLER_FOR has 25 edges across 8 mechanic categories: cares_about_counters (6), ramps_mana (6), untap_synergy (5), sacrifices (4), etb_trigger (1), reanimates (1), draws_cards (1), lands_matter (1).
- PAYOFF_FOR has only 2 edges: Lightning Coils → death_trigger, Myr Prototype → cares_about_counters.
- Enabler↔Payoff pairs exist (e.g. Battlegrowth → cares_about_counters ← Myr Prototype).
- Maximum shared mechanic tags between any two cards is 2 (7 such pairs exist). No pairs share 3+ tags.
- `find_combos` tool uses three strategies: (1) enabler/payoff pairings, (2) co-enabler discovery, (3) complementary tag-name pattern matching with a defined mapping (sacrifice↔death/graveyard, blink↔etb, etc.).
- Complementary tag patterns are defined as constants in find-combos.ts — easy to extend.

## Tribal Tool Data (Task 5.0)

- 484 TRIBAL_LORD_OF edges total across many creature types.
- Top tribes by lord count: Sliver (93), Zombie (26), Elf (22), Human (22), Goblin (19), Soldier (17), Knight (13), Dragon (13).
- Lords include non-creature cards (e.g. Sorceries, Planeswalkers, Enchantments) — not just creature type members.
- TRIBAL_LORD_OF `buff` property is a descriptive string like "get +1/+1 and have lifelink".
- No "tribal" MechanicTags exist in the database, so the tool doesn't use PAYOFF_FOR/ENABLER_FOR for tribal mechanics.
- The tool uses three strategies: (1) lords via TRIBAL_LORD_OF, (2) top creatures of the type via HAS_CREATURE_TYPE, (3) support cards that reference the type name in oracle_text but aren't members.
- CreatureType names are capitalised (e.g. "Zombie" not "zombie") — tool does case-insensitive matching as fallback.
- Top creature types by card count: Human (4190), Warrior (1196), Wizard (1172), Soldier (990), Elf (641), Zombie (599), Goblin (509).

## Legality Tool Data (Task 6.0)

- `check_legality` uses UNWIND + OPTIONAL MATCH to check multiple cards in a single Cypher query rather than looping per card.
- Card name matching is case-insensitive via `toLower()`. The tool returns the resolved (proper-cased) name from the DB.
- LEGAL_IN edges have a `status` property: `"legal"` or `"restricted"`. If no edge exists, the card is not legal in that format.
- Sol Ring: legal in commander, not legal in standard/modern. Lightning Bolt: legal in commander and modern.

## Integration & Polish (Task 8.0)

- 94 total tests across 8 test files (3 db, 10 search, 14 synergies, 10 combos, 11 tribal, 10 legality, 11 get-card, 25 E2E integration).
- E2E integration test (`integration.test.ts`) covers: server health (7 tools listed, descriptions non-empty, schemas present), all 7 tools smoke tests, 5 error handling cases, 4 tool chaining workflows.
- Tool chaining workflows tested: find_synergies→find_by_mechanic→check_legality, get_card→find_combos→check_legality, search_cards→get_card, find_tribal→check_legality.
- Invalid format names are handled gracefully by all tools — they return "no results" or "not legal" rather than errors, since no LEGAL_IN edges exist for unknown formats.
- Improved `search_cards` and `get_card` descriptions with cross-tool guidance to help the LLM choose the right tool.

## MCP Client Config (Task 9.0)

- `.vscode/mcp.json` uses `"type": "stdio"` with `npx tsx src/server.ts` and `cwd: "${workspaceFolder}/mtg-mcp"`.
- VS Code MCP config uses `servers` as the top-level key (not `mcpServers`).
- Claude Desktop config uses `mcpServers` as the top-level key and requires an absolute path for `cwd`.
- Server verified working with real MCP client: 7 tools listed, get_card returns correct data for Sol Ring (EDHREC Rank #1).
