import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withReadSession } from "../db.js";
import type { CardDetail } from "../types.js";

interface GetCardResponse {
  found: boolean;
  card: CardDetail | null;
}

/**
 * Get full details for a specific card by name.
 * Returns all Card properties plus related keywords, creature types, card types,
 * mechanic tags, color identity, produced mana, and format legalities.
 */
async function getCard(cardName: string): Promise<GetCardResponse> {
  return withReadSession(async (tx) => {
    const { records } = await tx.run(
      `
      MATCH (c:Card)
      WHERE toLower(c.name) = toLower($card_name)

      OPTIONAL MATCH (c)-[:HAS_KEYWORD]->(kw:Keyword)
      WITH c, COLLECT(DISTINCT kw.name) AS keywords

      OPTIONAL MATCH (c)-[:HAS_CREATURE_TYPE]->(ct:CreatureType)
      WITH c, keywords, COLLECT(DISTINCT ct.name) AS creature_types

      OPTIONAL MATCH (c)-[:HAS_CARD_TYPE]->(ctype:CardType)
      WITH c, keywords, creature_types, COLLECT(DISTINCT ctype.name) AS card_types

      OPTIONAL MATCH (c)-[:HAS_MECHANIC]->(mt:MechanicTag)
      WITH c, keywords, creature_types, card_types, COLLECT(DISTINCT mt.name) AS mechanic_tags

      OPTIONAL MATCH (c)-[:PRODUCES_MANA_FOR]->(pm:Color)
      WITH c, keywords, creature_types, card_types, mechanic_tags, COLLECT(DISTINCT pm.name) AS produced_mana

      OPTIONAL MATCH (c)-[legal:LEGAL_IN]->(f:Format)
      WITH c, keywords, creature_types, card_types, mechanic_tags, produced_mana,
           COLLECT({ format: f.name, status: legal.status }) AS legalities

      RETURN
        c.name AS name,
        c.oracle_text AS oracle_text,
        c.mana_cost AS mana_cost,
        c.cmc AS cmc,
        c.type_line AS type_line,
        c.colors AS colors,
        c.color_identity AS color_identity,
        c.power AS power,
        c.toughness AS toughness,
        c.loyalty AS loyalty,
        c.rarity AS rarity,
        c.set_code AS set_code,
        c.edhrec_rank AS edhrec_rank,
        c.produced_mana AS produced_mana_prop,
        c.image_uri AS image_uri,
        keywords,
        creature_types,
        card_types,
        mechanic_tags,
        produced_mana,
        legalities
      `,
      { card_name: cardName }
    );

    if (records.length === 0) {
      return { found: false, card: null };
    }

    const record = records[0];

    const cmcRaw = record.get("cmc");
    const cmc = typeof cmcRaw === "object" && cmcRaw !== null && "toNumber" in cmcRaw
      ? (cmcRaw as { toNumber: () => number }).toNumber()
      : (cmcRaw as number) ?? 0;

    const edhrecRaw = record.get("edhrec_rank");
    const edhrec_rank = edhrecRaw === null || edhrecRaw === undefined
      ? null
      : typeof edhrecRaw === "object" && "toNumber" in edhrecRaw
        ? (edhrecRaw as { toNumber: () => number }).toNumber()
        : (edhrecRaw as number);

    const legalitiesRaw = record.get("legalities") as Array<{ format: string; status: string }>;
    const legalities: Record<string, string> = {};
    for (const entry of legalitiesRaw) {
      legalities[entry.format] = entry.status;
    }

    const card: CardDetail = {
      name: record.get("name") as string,
      oracle_text: (record.get("oracle_text") as string) ?? null,
      mana_cost: (record.get("mana_cost") as string) ?? "",
      cmc,
      type_line: (record.get("type_line") as string) ?? "",
      colors: (record.get("colors") as string[]) ?? [],
      color_identity: (record.get("color_identity") as string[]) ?? [],
      power: (record.get("power") as string) ?? null,
      toughness: (record.get("toughness") as string) ?? null,
      loyalty: (record.get("loyalty") as string) ?? null,
      rarity: (record.get("rarity") as string) ?? "",
      set_code: (record.get("set_code") as string) ?? "",
      keywords: (record.get("keywords") as string[]) ?? [],
      creature_types: (record.get("creature_types") as string[]) ?? [],
      card_types: (record.get("card_types") as string[]) ?? [],
      mechanic_tags: (record.get("mechanic_tags") as string[]) ?? [],
      edhrec_rank,
      produced_mana: (record.get("produced_mana") as string[]) ?? [],
      legalities,
      image_uri: (record.get("image_uri") as string) ?? undefined,
    };

    return { found: true, card };
  });
}

/** Format the card detail response as readable text */
function formatResponse(response: GetCardResponse, cardName: string): string {
  if (!response.found || !response.card) {
    return `Card not found: "${cardName}". Check the spelling and try again.`;
  }

  const c = response.card;
  const lines: string[] = [];

  // Header
  lines.push(`# ${c.name} ${c.mana_cost}`);
  lines.push(c.type_line);
  lines.push("");

  // Oracle text
  if (c.oracle_text) {
    lines.push(c.oracle_text);
    lines.push("");
  }

  // Power / Toughness / Loyalty
  if (c.power !== null && c.toughness !== null) {
    lines.push(`**P/T:** ${c.power}/${c.toughness}`);
  }
  if (c.loyalty !== null) {
    lines.push(`**Loyalty:** ${c.loyalty}`);
  }

  // Stats
  lines.push(`**CMC:** ${c.cmc}`);
  lines.push(`**Colors:** ${c.colors.length > 0 ? c.colors.join(", ") : "Colorless"}`);
  lines.push(`**Color Identity:** ${c.color_identity.length > 0 ? c.color_identity.join(", ") : "Colorless"}`);
  lines.push(`**Rarity:** ${c.rarity}`);
  lines.push(`**Set:** ${c.set_code}`);

  if (c.edhrec_rank !== null) {
    lines.push(`**EDHREC Rank:** ${c.edhrec_rank}`);
  }

  // Relationships
  if (c.keywords.length > 0) {
    lines.push(`**Keywords:** ${c.keywords.join(", ")}`);
  }
  if (c.creature_types.length > 0) {
    lines.push(`**Creature Types:** ${c.creature_types.join(", ")}`);
  }
  if (c.card_types.length > 0) {
    lines.push(`**Card Types:** ${c.card_types.join(", ")}`);
  }
  if (c.mechanic_tags.length > 0) {
    lines.push(`**Mechanic Tags:** ${c.mechanic_tags.join(", ")}`);
  }
  if (c.produced_mana.length > 0) {
    lines.push(`**Produces Mana:** ${c.produced_mana.join(", ")}`);
  }

  // Legalities
  if (Object.keys(c.legalities).length > 0) {
    lines.push("");
    lines.push("**Format Legalities:**");
    const sorted = Object.entries(c.legalities).sort(([a], [b]) => a.localeCompare(b));
    for (const [format, status] of sorted) {
      const icon = status === "legal" ? "✅" : status === "restricted" ? "⚠️" : "❌";
      lines.push(`${icon} ${format}: ${status}`);
    }
  }

  return lines.join("\n");
}

/** Register the get_card tool on the MCP server */
export function registerGetCard(server: McpServer): void {
  server.tool(
    "get_card",
    "Get full details for a specific Magic: The Gathering card by name. " +
      "Returns all card properties: oracle text, mana cost, type line, power/toughness, " +
      "keywords, creature types, card types, mechanic tags, color identity, produced mana, " +
      "EDHREC rank, and format legalities. Use this when you need comprehensive information " +
      "about a single card.",
    {
      card_name: z.string().describe(
        "The card name to look up. Matched case-insensitively."
      ),
    },
    async (params) => {
      try {
        const response = await getCard(params.card_name);
        return {
          content: [{ type: "text" as const, text: formatResponse(response, params.card_name) }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error getting card details: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
