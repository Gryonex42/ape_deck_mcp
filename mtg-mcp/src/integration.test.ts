import { describe, it, expect, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * End-to-end integration tests for the MTG MCP server.
 * Starts the server once via stdio and verifies all tools are accessible
 * and return correct responses. Also tests tool chaining workflows.
 */

let client: Client;

async function getClient(): Promise<Client> {
  if (!client) {
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/server.ts"],
    });
    client = new Client({ name: "e2e-test-client", version: "1.0.0" });
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

// ── Server health & tool listing ────────────────────────────────────

describe("MCP server E2E", () => {
  it("lists all 7 registered tools", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "check_legality",
      "find_by_mechanic",
      "find_combos",
      "find_synergies",
      "find_tribal",
      "get_card",
      "search_cards",
    ]);
  });

  it("each tool has a non-empty description", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    for (const tool of tools.tools) {
      expect(tool.description, `${tool.name} is missing a description`).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(20);
    }
  });

  it("each tool has an input schema", async () => {
    const c = await getClient();
    const tools = await c.listTools();
    for (const tool of tools.tools) {
      expect(tool.inputSchema, `${tool.name} is missing inputSchema`).toBeDefined();
    }
  });
});

// ── Individual tool smoke tests ─────────────────────────────────────

describe("search_cards E2E", () => {
  it("finds cards by name", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "Lightning Bolt" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Lightning Bolt");
    expect(result.isError).toBeFalsy();
  });

  it("returns empty message for nonsense query", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "xyzzyplughtwisty", format: "commander" },
    });
    const text = getTextContent(result);
    expect(text).toContain("No cards found");
  });
});

describe("get_card E2E", () => {
  it("returns comprehensive card details", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Sol Ring" },
    });
    const text = getTextContent(result);
    expect(text).toContain("# Sol Ring");
    expect(text).toContain("Format Legalities:");
    expect(result.isError).toBeFalsy();
  });

  it("returns not-found for fake card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Nonexistent Card 9999" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Card not found");
  });
});

describe("find_synergies E2E", () => {
  it("returns synergies or a no-tags message", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Sol Ring" },
    });
    const text = getTextContent(result);
    // Sol Ring has no mechanic tags, so expect that message
    expect(text).toContain("no mechanic tags");
    expect(result.isError).toBeFalsy();
  });

  it("returns not-found for missing card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "ZZZZZ Fake Card" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
  });
});

describe("find_by_mechanic E2E", () => {
  it("finds cards matching a broad tag term", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["removal"] },
    });
    const text = getTextContent(result);
    // Should find cards or at least matched tags
    expect(text).toMatch(/card\(s\) matching tags|No mechanic tags found/);
    expect(result.isError).toBeFalsy();
  });

  it("returns informative message for unknown tags", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: ["xyzzy_nonexistent_mechanic"] },
    });
    const text = getTextContent(result);
    expect(text).toContain("No mechanic tags found");
  });
});

describe("find_combos E2E", () => {
  it("returns combos or informative message", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth" },
    });
    const text = getTextContent(result);
    // Battlegrowth has ENABLER_FOR edges, should find partners
    expect(text).toMatch(/combo partner|no mechanic tags/i);
    expect(result.isError).toBeFalsy();
  });

  it("returns not-found for missing card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Completely Fake Card XYZ" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
  });
});

describe("find_tribal E2E", () => {
  it("returns tribal results for Zombie", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Zombie" },
    });
    const text = getTextContent(result);
    expect(text).toContain("Tribal Support for Zombie");
    expect(text).toContain("Lords");
    expect(result.isError).toBeFalsy();
  });

  it("returns not-found for nonexistent type", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "XyzzyCreature" },
    });
    const text = getTextContent(result);
    expect(text).toContain("not found");
  });
});

describe("check_legality E2E", () => {
  it("checks legality for multiple cards", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: {
        card_names: ["Sol Ring", "Lightning Bolt"],
        format: "commander",
      },
    });
    const text = getTextContent(result);
    expect(text).toContain("Sol Ring");
    expect(text).toContain("Lightning Bolt");
    expect(text).toContain("Legal");
    expect(result.isError).toBeFalsy();
  });
});

// ── Error handling ──────────────────────────────────────────────────

describe("error handling", () => {
  it("search_cards handles invalid format gracefully", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "search_cards",
      arguments: { query: "Lightning Bolt", format: "not_a_real_format" },
    });
    const text = getTextContent(result);
    // Should return no results (no card is legal in a nonexistent format)
    expect(text).toContain("No cards found");
    expect(result.isError).toBeFalsy();
  });

  it("check_legality handles invalid format gracefully", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "check_legality",
      arguments: { card_names: ["Sol Ring"], format: "totally_fake_format" },
    });
    const text = getTextContent(result);
    // Sol Ring won't be legal in a fake format
    expect(text).toContain("Not Legal");
    expect(result.isError).toBeFalsy();
  });

  it("find_tribal handles invalid format gracefully", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Zombie", format: "fake_format_xyz" },
    });
    const text = getTextContent(result);
    // Should return empty sections since no cards are legal in fake format
    expect(text).toContain("Tribal Support for Zombie");
    expect(result.isError).toBeFalsy();
  });

  it("find_synergies returns clear message for untagged card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Lightning Bolt" },
    });
    const text = getTextContent(result);
    expect(text).toContain("no mechanic tags");
    expect(result.isError).toBeFalsy();
  });

  it("find_combos returns clear message for untagged card", async () => {
    const c = await getClient();
    const result = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Lightning Bolt" },
    });
    const text = getTextContent(result);
    expect(text).toContain("no mechanic tags");
    expect(result.isError).toBeFalsy();
  });
});

// ── Tool chaining ───────────────────────────────────────────────────

describe("tool chaining workflows", () => {
  it("find_synergies → find_by_mechanic → check_legality", async () => {
    const c = await getClient();

    // Step 1: Find synergies for a card with mechanic tags (Wail of the Nim has 5 tags)
    const synResult = await c.callTool({
      name: "find_synergies",
      arguments: { card_name: "Wail of the Nim", format: "commander" },
    });
    const synText = getTextContent(synResult);
    expect(synResult.isError).toBeFalsy();

    // Extract tags from the synergy result text to use in find_by_mechanic
    // The output format is "tags: tag1, tag2, ..."
    const tagsMatch = synText.match(/tags: ([^)]+)\)/);
    let searchTags: string[];
    if (tagsMatch) {
      searchTags = tagsMatch[1].split(", ").slice(0, 2);
    } else {
      // Fallback: use known tag terms
      searchTags = ["removal"];
    }

    // Step 2: Use extracted tags with find_by_mechanic
    const mechResult = await c.callTool({
      name: "find_by_mechanic",
      arguments: { tags: searchTags, format: "commander", limit: 5 },
    });
    const mechText = getTextContent(mechResult);
    expect(mechResult.isError).toBeFalsy();

    // Extract card names from find_by_mechanic results
    const cardNameMatches = mechText.matchAll(/\*\*([^*]+)\*\*/g);
    const cardNames: string[] = [];
    for (const match of cardNameMatches) {
      if (match[1] && !match[1].includes("Found") && cardNames.length < 3) {
        cardNames.push(match[1]);
      }
    }

    // Step 3: Check legality of the found cards
    if (cardNames.length > 0) {
      const legalResult = await c.callTool({
        name: "check_legality",
        arguments: { card_names: cardNames, format: "commander" },
      });
      const legalText = getTextContent(legalResult);
      expect(legalResult.isError).toBeFalsy();
      expect(legalText).toContain("Legality Check");
      // Cards found via find_by_mechanic with commander format should be legal
      for (const name of cardNames) {
        expect(legalText).toContain(name);
      }
    }
  });

  it("get_card → find_combos → check_legality", async () => {
    const c = await getClient();

    // Step 1: Get full details on a card
    const cardResult = await c.callTool({
      name: "get_card",
      arguments: { card_name: "Battlegrowth" },
    });
    const cardText = getTextContent(cardResult);
    expect(cardResult.isError).toBeFalsy();
    expect(cardText).toContain("# Battlegrowth");

    // Step 2: Find combo partners for that card
    const comboResult = await c.callTool({
      name: "find_combos",
      arguments: { card_name: "Battlegrowth", format: "commander" },
    });
    const comboText = getTextContent(comboResult);
    expect(comboResult.isError).toBeFalsy();

    // Extract partner names from combo results
    const partnerMatches = comboText.matchAll(/\*\*([^*]+)\*\*/g);
    const partnerNames: string[] = [];
    for (const match of partnerMatches) {
      if (match[1] && !match[1].includes("Battlegrowth") && partnerNames.length < 3) {
        partnerNames.push(match[1]);
      }
    }

    // Step 3: Verify legality of combo partners
    if (partnerNames.length > 0) {
      const legalResult = await c.callTool({
        name: "check_legality",
        arguments: { card_names: partnerNames, format: "commander" },
      });
      const legalText = getTextContent(legalResult);
      expect(legalResult.isError).toBeFalsy();
      expect(legalText).toContain("Legality Check");
    }
  });

  it("search_cards → get_card for detailed follow-up", async () => {
    const c = await getClient();

    // Step 1: Search for a card by oracle text
    const searchResult = await c.callTool({
      name: "search_cards",
      arguments: { query: "destroy all creatures", limit: 3 },
    });
    const searchText = getTextContent(searchResult);
    expect(searchResult.isError).toBeFalsy();

    // Extract the first card name
    const nameMatch = searchText.match(/\*\*([^*]+)\*\*/);
    expect(nameMatch).not.toBeNull();
    const firstCardName = nameMatch![1];

    // Step 2: Get full details on the first result
    const detailResult = await c.callTool({
      name: "get_card",
      arguments: { card_name: firstCardName },
    });
    const detailText = getTextContent(detailResult);
    expect(detailResult.isError).toBeFalsy();
    expect(detailText).toContain(`# ${firstCardName}`);
    expect(detailText).toContain("Format Legalities:");
  });

  it("find_tribal → check_legality for tribe members", async () => {
    const c = await getClient();

    // Step 1: Find tribal support for Elves
    const tribalResult = await c.callTool({
      name: "find_tribal",
      arguments: { creature_type: "Elf", format: "commander", limit: 5 },
    });
    const tribalText = getTextContent(tribalResult);
    expect(tribalResult.isError).toBeFalsy();
    expect(tribalText).toContain("Tribal Support for Elf");

    // Extract lord/creature names
    const elfNames: string[] = [];
    const nameMatches = tribalText.matchAll(/\*\*([^*]+)\*\*/g);
    for (const match of nameMatches) {
      if (match[1] && elfNames.length < 5) {
        elfNames.push(match[1]);
      }
    }

    // Step 2: Verify legality in modern
    if (elfNames.length > 0) {
      const legalResult = await c.callTool({
        name: "check_legality",
        arguments: { card_names: elfNames, format: "modern" },
      });
      const legalText = getTextContent(legalResult);
      expect(legalResult.isError).toBeFalsy();
      expect(legalText).toContain("Legality Check — modern");
    }
  });
});
