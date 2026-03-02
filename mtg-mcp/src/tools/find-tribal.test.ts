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

describe("find_tribal MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "find_tribal");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("tribal");
  });

  it("finds zombie lords, creatures, and support cards", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Zombie" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Zombie");
    expect(text).toContain("## Lords");
    expect(text).toContain("## Top Creatures");
    expect(text).toContain("## Support Cards");
    // Should find at least some zombie lords
    expect(text).toContain("Buff:");
    expect(result.isError).toBeFalsy();
  });

  it("finds elf tribal support", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Elf" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Elf");
    expect(text).toContain("## Lords");
    expect(result.isError).toBeFalsy();
  });

  it("handles case-insensitive creature type", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "zombie" },
    });
    const text = getTextContent(result);
    // Should resolve to "Zombie" and find results
    expect(text).toContain("Tribal Support for Zombie");
    expect(text).toContain("## Lords");
    expect(result.isError).toBeFalsy();
  });

  it("returns not-found for nonexistent creature type", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Xyzzyfolk" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
    expect(text).toContain("Xyzzyfolk");
    expect(result.isError).toBeFalsy();
  });

  it("filters by color identity", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Zombie", color_identity: ["B"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Zombie");
    // All returned cards should be within mono-black identity
    expect(text).not.toMatch(/Colors:.*W/);
    expect(text).not.toMatch(/Colors:.*U/);
    expect(text).not.toMatch(/Colors:.*R/);
    expect(text).not.toMatch(/Colors:.*G/);
    expect(result.isError).toBeFalsy();
  });

  it("filters by format", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Goblin", format: "modern" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Goblin");
    expect(result.isError).toBeFalsy();
  });

  it("respects limit parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Zombie", limit: 3 },
    });
    const text = getTextContent(result);
    // Each section should have at most 3 entries
    // Lords section: count separator lines between "## Lords" and "## Top Creatures"
    const lordsSection = text.split("## Top Creatures")[0].split("## Lords")[1] ?? "";
    if (lordsSection.includes("---")) {
      const lordSeparators = (lordsSection.match(/---/g) || []).length;
      // N cards = N-1 separators, so max 2 separators for 3 cards
      expect(lordSeparators).toBeLessThanOrEqual(2);
    }
    expect(result.isError).toBeFalsy();
  });

  it("works for a creature type with no lords", async () => {
    // "Horror" has many creatures but likely fewer lords
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Horror" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Horror");
    // Should still have creature results even if no lords
    expect(text).toContain("## Top Creatures");
    expect(result.isError).toBeFalsy();
  });

  it("finds sliver tribal support (many lords)", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Sliver", limit: 5 },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Sliver");
    expect(text).toContain("## Lords");
    expect(text).toContain("Buff:");
    expect(result.isError).toBeFalsy();
  });

  it("finds dragon tribal with color filter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Dragon", color_identity: ["R"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Dragon");
    // Only mono-red cards
    expect(text).not.toMatch(/Colors:.*W/);
    expect(text).not.toMatch(/Colors:.*U/);
    expect(text).not.toMatch(/Colors:.*B/);
    expect(text).not.toMatch(/Colors:.*G/);
    expect(result.isError).toBeFalsy();
  });
});
