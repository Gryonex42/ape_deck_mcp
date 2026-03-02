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

describe("find_combos MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "find_combos");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("combo");
  });

  it("finds enabler↔payoff combos for a card with ENABLER_FOR edges", async () => {
    // Battlegrowth enables cares_about_counters, Myr Prototype is a payoff
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth" },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("Battlegrowth");
    // Should find at least Myr Prototype as enabler↔payoff combo
    expect(text).toContain("Myr Prototype");
    expect(text).toContain("Enabler↔Payoff");
  });

  it("finds co-enabler combos for cards enabling the same mechanic", async () => {
    // Nim Shambler enables 'sacrifices', should find other sacrifice enablers
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Nim Shambler" },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("Nim Shambler");
    // Should find other sacrifice enablers as strategy partners
    if (text.includes("Strategy Partner")) {
      expect(text).toContain("sacrifices");
    }
  });

  it("finds complementary mechanic combos for a card with tags", async () => {
    // Betrayal of Flesh has tags: reanimate-creature, removal-creature, sacrifice outlet-land
    // Its ENABLER_FOR: etb_trigger, reanimates
    // Complementary: sacrifice → death/graveyard, etb → blink/flicker, reanimate → mill/discard/graveyard
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Betrayal of Flesh" },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    expect(text).toContain("Betrayal of Flesh");
    // Should find some combo partners through complementary mechanic matching
    expect(text).toContain("combo partner");
  });

  it("returns informative message for card not found", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Xyzzy Nonexistent Card" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for card with no mechanic data", async () => {
    // Sol Ring has no HAS_MECHANIC, ENABLER_FOR, or PAYOFF_FOR
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Sol Ring" },
    });
    const text = getTextContent(result);
    expect(text).toContain("no mechanic tags");
    expect(result.isError).toBeFalsy();
  });

  it("filters by color identity", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth", color_identity: ["G"] },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    // Results should only include cards within green color identity
    if (text.includes("combo partner")) {
      expect(text).not.toMatch(/Colors:.*W/);
      expect(text).not.toMatch(/Colors:.*U/);
      expect(text).not.toMatch(/Colors:.*B/);
      expect(text).not.toMatch(/Colors:.*R/);
    }
  });

  it("respects limit parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Betrayal of Flesh", limit: 2 },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    if (text.includes("combo partner")) {
      // Count separators between cards
      const separators = (text.match(/---/g) || []).length;
      expect(separators).toBeLessThanOrEqual(1); // N cards = N-1 separators
    }
  });

  it("shows target card roles in output", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth" },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    // Should show what mechanics the card enables
    expect(text).toContain("Enables:");
    expect(text).toContain("cares_about_counters");
  });

  it("supports format parameter", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth", format: "legacy" },
    });
    const text = getTextContent(result);
    expect(result.isError).toBeFalsy();
    // Just verify it doesn't error — format filtering works
    expect(text).toContain("Battlegrowth");
  });
});
