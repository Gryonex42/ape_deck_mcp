import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDriver } from "./db.js";
import { registerSearchCards } from "./tools/search-cards.js";

const server = new McpServer({
  name: "mtg-mcp",
  version: "1.0.0",
});

// Register tools
registerSearchCards(server);

// Graceful shutdown
async function shutdown() {
  console.error("Shutting down MCP server...");
  await server.close();
  await closeDriver();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Connect via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MTG MCP server running on stdio");
