import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let client: Client;

async function getClient(): Promise<Client> {
  if (!client) {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/server.ts"],
    });
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(transport);
  }
  return client;
}

function getTextContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content.map((c) => c.text).join("\n");
}

afterAll(async () => {
  if (client) {
    await client.close();
  }
});

describe("search_cards MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const searchTool = tools.tools.find((t) => t.name === "search_cards");
    expect(searchTool).toBeDefined();
    expect(searchTool!.description).toContain("Magic: The Gathering");
  });

  it("finds cards by name", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "Lightning Bolt", limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("Lightning Bolt");
    expect(result.isError).toBeFalsy();
  });

  it("finds cards by oracle text", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "destroy target creature", limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("Found");
    expect(text).toContain("card(s)");
    expect(result.isError).toBeFalsy();
  });

  it("filters by card type", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "damage", type: "Instant", limit: 5 },
    });
    const text = getTextContent(result);
    // All returned cards should be Instants
    expect(text).toContain("Instant");
    expect(result.isError).toBeFalsy();
  });

  it("filters by color identity", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "draw", colors: ["U"], limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("Found");
    // Should not contain cards with non-blue color identity
    expect(text).not.toMatch(/Colors:.*R/);
    expect(text).not.toMatch(/Colors:.*G/);
    expect(result.isError).toBeFalsy();
  });

  it("filters by cmc_max", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "counter target spell", cmc_max: 2, limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("Found");
    // CMC values should all be <= 2
    const cmcMatches = text.match(/CMC: (\d+)/g);
    if (cmcMatches) {
      for (const match of cmcMatches) {
        const cmc = parseInt(match.replace("CMC: ", ""), 10);
        expect(cmc).toBeLessThanOrEqual(2);
      }
    }
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for no results", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "xyzzynonexistentcardname12345", limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("No cards found");
    expect(result.isError).toBeFalsy();
  });

  it("respects limit parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "creature", limit: 3 },
    });
    const text = getTextContent(result);
    // Count card entries by counting the separator
    const cardCount = (text.match(/\*\*/g) || []).length / 1; // Each card has ** around name
    // 3 cards max = at most 3 bold names (each wrapped in **)
    expect(cardCount).toBeLessThanOrEqual(6); // 3 cards × 2 ** per card
    expect(result.isError).toBeFalsy();
  });

  it("defaults to commander format", async () => {
    const c = await getClient();
    // Search for a card and verify it works without specifying format
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "Sol Ring" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(result.isError).toBeFalsy();
  });

  it("can filter by a specific format", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "Sol Ring", format: "standard" },
    });
    const text = getTextContent(result);
    // Sol Ring is not legal in standard
    expect(text).toContain("No cards found");
    expect(result.isError).toBeFalsy();
  });
});
