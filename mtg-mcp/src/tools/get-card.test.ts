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

describe("get_card MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "get_card");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("full details");
  });

  it("returns full details for Sol Ring", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Sol Ring" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Sol Ring");
    expect(text).toContain("Artifact");
    expect(text).toContain("CMC:");
    expect(text).toContain("Color Identity:");
    expect(text).toContain("Rarity:");
    expect(text).toContain("Format Legalities:");
    expect(text).toContain("commander: legal");
  });

  it("returns creature-specific fields for a creature card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Llanowar Elves" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Llanowar Elves");
    expect(text).toContain("P/T:");
    expect(text).toContain("Creature Types:");
    expect(text).toContain("Elf");
  });

  it("returns keywords for a card with keywords", async () => {
    const c = await getClient();
    // Serra Angel has Flying and Vigilance
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Serra Angel" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Keywords:");
    expect(text).toContain("Flying");
    expect(text).toContain("Vigilance");
  });

  it("handles case-insensitive card names", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "sol ring" },
    });
    const text = getTextContent(result);
    // Should resolve to proper-cased name
    expect(text).toContain("# Sol Ring");
  });

  it("returns not found for a nonexistent card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Xyzzy Totally Fake Card" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Card not found");
    expect(text).toContain("Xyzzy Totally Fake Card");
  });

  it("returns card types", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Lightning Bolt" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Lightning Bolt");
    expect(text).toContain("Card Types:");
    expect(text).toContain("Instant");
  });

  it("returns oracle text for a card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Counterspell" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Counterspell");
    expect(text).toContain("Counter target spell");
  });

  it("shows EDHREC rank when available", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Sol Ring" },
    });
    const text = getTextContent(result);
    expect(text).toContain("EDHREC Rank:");
  });

  it("returns color identity for a multicolor card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Niv-Mizzet, Parun" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Niv-Mizzet, Parun");
    expect(text).toContain("Color Identity:");
    // Should contain blue and red
    expect(text).toMatch(/U/);
    expect(text).toMatch(/R/);
  });

  it("returns loyalty for a planeswalker", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Jace, the Mind Sculptor" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Loyalty:");
  });
});
