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
