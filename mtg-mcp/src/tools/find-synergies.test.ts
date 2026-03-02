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

// ── find_synergies ──────────────────────────────────────────────────────

describe("find_synergies MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "find_synergies");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("synerg");
  });

  it("finds synergies for a card with mechanic tags", async () => {
    // Wail of the Nim has 5 tags — should find some synergies
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Wail of the Nim" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Wail of the Nim");
    expect(text).toContain("synergy score");
    expect(text).toContain("Shared tags:");
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for card with no tags", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Lightning Bolt" },
    });
    const text = getTextContent(result);
    expect(text).toContain("no mechanic tags");
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for card not found", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Xyzzy Nonexistent Card" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
    expect(result.isError).toBeFalsy();
  });

  it("filters by color identity", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Wail of the Nim", color_identity: ["B"] },
    });
    const text = getTextContent(result);
    // Should not contain cards outside black color identity
    expect(result.isError).toBeFalsy();
    // Any cards returned should be within black identity
    if (text.includes("synergy score")) {
      expect(text).not.toMatch(/Colors:.*W/);
      expect(text).not.toMatch(/Colors:.*U/);
      expect(text).not.toMatch(/Colors:.*R/);
      expect(text).not.toMatch(/Colors:.*G/);
    }
  });

  it("respects limit parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Wail of the Nim", limit: 3 },
    });
    const text = getTextContent(result);
    if (text.includes("synergy score")) {
      // Count the card entries by counting the separator
      const separators = (text.match(/---/g) || []).length;
      // N cards have N-1 separators
      expect(separators).toBeLessThanOrEqual(2);
    }
    expect(result.isError).toBeFalsy();
  });
});

// ── find_by_mechanic ────────────────────────────────────────────────────

describe("find_by_mechanic MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "find_by_mechanic");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("mechanic");
  });

  it("finds cards by exact tag name", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["ramp"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("ramp");
    expect(result.isError).toBeFalsy();
  });

  it("finds cards by broader term matching multiple tags", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["removal"] },
    });
    const text = getTextContent(result);
    // Should match multiple removal-* tags
    expect(text).toContain("removal");
    expect(result.isError).toBeFalsy();
  });

  it("accepts multiple tags", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["ramp", "draw"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("card(s)");
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for unmatched tags", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["xyzzynonexistenttag"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("No mechanic tags found");
    expect(result.isError).toBeFalsy();
  });

  it("filters by color identity", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["removal"], colors: ["B"] },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    if (text.includes("card(s)")) {
      expect(text).not.toMatch(/Colors:.*W/);
      expect(text).not.toMatch(/Colors:.*U/);
      expect(text).not.toMatch(/Colors:.*R/);
      expect(text).not.toMatch(/Colors:.*G/);
    }
  });

  it("filters by cmc_max", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["removal"], cmc_max: 3 },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    const cmcMatches = text.match(/CMC: (\d+)/g);
    if (cmcMatches) {
      for (const match of cmcMatches) {
        const cmc = parseInt(match.replace("CMC: ", ""), 10);
        expect(cmc).toBeLessThanOrEqual(3);
      }
    }
  });

  it("respects limit parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["removal"], limit: 2 },
    });
    const text = getTextContent(result);
    if (text.includes("card(s)")) {
      const separators = (text.match(/---/g) || []).length;
      expect(separators).toBeLessThanOrEqual(1);
    }
    expect(result.isError).toBeFalsy();
  });
});
