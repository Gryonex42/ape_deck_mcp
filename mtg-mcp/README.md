# MTG MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that provides AI assistants with structured access to a Neo4j graph database of Magic: The Gathering card data. It exposes tools for card search, synergy discovery, combo finding, tribal support, legality checking, and detailed card lookups — all without requiring the LLM to write any database queries.

## Prerequisites

- **Node.js 18+**
- **Neo4j 5.x** — with the MTG card database already populated by the ingestion pipeline (`../src/`)
- The Neo4j database must have the full-text index `card_oracle_text` on `Card.oracle_text`

## Setup

1. **Install dependencies:**

   ```bash
   cd mtg-mcp
   npm install
   ```

2. **Configure environment variables:**

   Copy `.env.example` to `.env` and fill in your Neo4j credentials:

   ```bash
   cp .env.example .env
   ```

   ```env
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password_here
   ```

3. **Verify the connection:**

   ```bash
   npx vitest run src/db.test.ts
   ```

## Running

The server communicates over **stdio** (standard MCP transport). It is not a web server — it's designed to be launched by an MCP-compatible client.

```bash
npm start
# or
npx tsx src/server.ts
```

## Tools

The server exposes 7 tools:

### `search_cards`
Search for cards by name or oracle text. Combines a full-text oracle search with a name substring match, deduplicates, and returns results ranked by relevance.

**Parameters:** `query` (required), `colors`, `type`, `cmc_max`, `format` (default: commander), `limit` (default: 10, max: 25)

**Example:** Search for board wipes in white/black:
```json
{ "query": "destroy all creatures", "colors": ["W", "B"], "format": "commander" }
```

---

### `get_card`
Get comprehensive details for a single card. Returns all properties including oracle text, mana cost, type line, power/toughness, loyalty, keywords, creature types, card types, mechanic tags, color identity, produced mana, EDHREC rank, and format legalities.

**Parameters:** `card_name` (required)

**Example:**
```json
{ "card_name": "Sol Ring" }
```

---

### `find_synergies`
Find cards sharing mechanic tags with a given card. Returns cards ranked by how many tags they share (synergy score). Useful for discovering cards that work well together based on shared mechanical roles.

**Parameters:** `card_name` (required), `format` (default: commander), `color_identity`, `limit` (default: 15, max: 25)

**Example:** Find cards that synergise with a sacrifice-themed card:
```json
{ "card_name": "Wail of the Nim", "color_identity": ["B"] }
```

---

### `find_by_mechanic`
Find cards by mechanic tag names or broader search terms. Tags are functional labels like `removal-exile`, `mana dork`, `draw engine`, `sacrifice outlet-creature`. Broader terms like `removal` match all tags containing that word.

**Parameters:** `tags` (required), `colors`, `cmc_max`, `format` (default: commander), `limit` (default: 15, max: 25)

**Example:** Find cheap ramp cards in green:
```json
{ "tags": ["ramp", "mana dork"], "colors": ["G"], "cmc_max": 3 }
```

---

### `find_combos`
Discover combo partners for a card through three strategies:
1. **Enabler↔Payoff** — cards that enable what the other pays off for
2. **Co-enablers** — cards that enable the same mechanic and work together
3. **Complementary mechanics** — cards whose tags suggest the other half of a combo (e.g. sacrifice + death triggers, blink + ETB)

**Parameters:** `card_name` (required), `format` (default: commander), `color_identity`, `limit` (default: 10, max: 25)

**Example:**
```json
{ "card_name": "Battlegrowth", "format": "commander" }
```

---

### `find_tribal`
Find tribal lords, creatures, and support cards for a creature type. Returns three categories:
- **Lords** — cards with `TRIBAL_LORD_OF` that buff the type
- **Top creatures** — members of that type ranked by EDHREC popularity
- **Support** — non-member cards that reference the type in their oracle text

**Parameters:** `creature_type` (required), `color_identity`, `format` (default: commander), `limit` (default: 10 per category, max: 25)

**Example:** Find Zombie tribal support in Dimir:
```json
{ "creature_type": "Zombie", "color_identity": ["U", "B"] }
```

---

### `check_legality`
Validate a list of card names against a format's legality. Returns each card's status: legal, restricted, not legal, or not found.

**Parameters:** `card_names` (required, 1–100), `format` (required)

**Example:**
```json
{ "card_names": ["Sol Ring", "Lightning Bolt", "Black Lotus"], "format": "commander" }
```

## Typical Workflows

Tools are designed to be chained:

1. **Card discovery → details → legality:**
   `search_cards` → `get_card` → `check_legality`

2. **Synergy exploration → mechanic search → legality:**
   `find_synergies` → `find_by_mechanic` → `check_legality`

3. **Combo finding → legality check:**
   `get_card` → `find_combos` → `check_legality`

4. **Tribal deck building:**
   `find_tribal` → `check_legality`

## MCP Client Configuration

### Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "mtg": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "/path/to/mtg-mcp"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your VS Code `settings.json` or workspace `.vscode/mcp.json`:

```json
{
  "mcpServers": {
    "mtg": {
      "command": "npx",
      "args": ["tsx", "src/server.ts"],
      "cwd": "${workspaceFolder}/mtg-mcp"
    }
  }
}
```

### Custom Agents

Use the `StdioClientTransport` from `@modelcontextprotocol/sdk`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/server.ts"],
});
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "search_cards",
  arguments: { query: "draw three cards" },
});
```

## Testing

```bash
# Run all tests
npx vitest run

# Run a specific test file
npx vitest run src/tools/search-cards.test.ts

# Run in watch mode
npx vitest
```

Tests are integration tests that start the MCP server via stdio and call tools through the MCP client SDK. They require a running Neo4j instance with the MTG data loaded.

## Architecture

```
mtg-mcp/
  src/
    server.ts              MCP server setup, tool registration, stdio transport
    config.ts              Env vars via dotenv + Zod
    db.ts                  Neo4j driver (read-only), session helper
    types.ts               Shared TypeScript interfaces
    integration.test.ts    E2E integration and tool chaining tests
    tools/
      search-cards.ts      General-purpose card search
      get-card.ts          Full card detail lookup
      find-synergies.ts    Shared mechanic tag synergies
      find-by-mechanic.ts  Cards by mechanic tag or category
      find-combos.ts       Combo partner discovery
      find-tribal.ts       Tribal lords, creatures, and support
      check-legality.ts    Format legality validation
```

All Cypher queries are pre-written with parameter binding — the LLM never generates or injects database queries. Every query uses `session.executeRead()` (read-only). Results are capped with `LIMIT` to keep responses within LLM context window limits.
