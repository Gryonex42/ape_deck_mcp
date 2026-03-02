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

describe("check_legality MCP tool", () => {
  it("is listed in tools/list", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const tool = tools.tools.find((t) => t.name === "check_legality");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("legality");
  });

  it("reports Sol Ring as legal in commander", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Sol Ring"], format: "commander" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Legal");
    expect(text).toContain("1 legal");
  });

  it("reports Lightning Bolt as legal in modern", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Lightning Bolt"], format: "modern" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Lightning Bolt");
    expect(text).toContain("Legal");
  });

  it("reports a nonexistent card as not found", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Xyzzy Totally Fake Card"], format: "commander" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Xyzzy Totally Fake Card");
    expect(text).toContain("Not Found");
    expect(text).toContain("1 not found");
  });

  it("checks multiple cards at once", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: {
        card_names: ["Sol Ring", "Lightning Bolt", "Counterspell"],
        format: "commander",
      },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Lightning Bolt");
    expect(text).toContain("Counterspell");
    // All three should be legal in commander
    expect(text).toContain("3 legal");
  });

  it("shows correct format in heading", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Sol Ring"], format: "standard" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Legality Check — standard");
  });

  it("handles mixed results (legal + not found)", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: {
        card_names: ["Sol Ring", "Fake Card Name 12345"],
        format: "commander",
      },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Legal");
    expect(text).toContain("Fake Card Name 12345");
    expect(text).toContain("Not Found");
    expect(text).toContain("1 legal");
    expect(text).toContain("1 not found");
  });

  it("handles case-insensitive card names", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["sol ring"], format: "commander" },
    });
    const text = getTextContent(result);
    // Should resolve to proper name "Sol Ring"
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Legal");
  });

  it("reports cards not legal in a format they are banned in", async () => {
    const c = await getClient();
    // Sol Ring is not legal in standard
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Sol Ring"], format: "standard" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Not Legal");
  });

  it("includes summary counts", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: {
        card_names: ["Sol Ring", "Lightning Bolt", "Nonexistent Card XYZ"],
        format: "commander",
      },
    });
    const text = getTextContent(result);
    expect(text).toContain("Summary");
    expect(text).toContain("3 total");
  });
});
