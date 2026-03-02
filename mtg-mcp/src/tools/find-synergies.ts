import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import neo4j from "neo4j-driver";
import { withReadSession } from "../db.js";
import type { SynergyResult } from "../types.js";

function neo4jInt(n: number) {
  return neo4j.int(Math.floor(n));
}

async function findSynergies(params: {
  card_name: string;
  format: string;
  color_identity?: string[];
  limit: number;
}): Promise<{ target_card: string; found: boolean; target_tags: string[]; synergies: SynergyResult[] }> {
  // First, find the target card's mechanic tags
  const targetInfo = await withReadSession(async (tx) => {
    const res = await tx.run(
      `
      MATCH (c:Card)
      WHERE toLower(c.name) = toLower($card_name)
      OPTIONAL MATCH (c)-[:HAS_MECHANIC]->(m:MechanicTag)
      RETURN c.name AS name, collect(m.name) AS tags
      LIMIT 1
      `,
      { card_name: params.card_name }
    );
    if (res.records.length === 0) return null;
    const record = res.records[0];
    return {
      name: record.get("name") as string,
      tags: record.get("tags") as string[],
    };
  });

  if (!targetInfo) {
    return { target_card: params.card_name, found: false, target_tags: [], synergies: [] };
  }

  if (targetInfo.tags.length === 0) {
    return { target_card: targetInfo.name, found: true, target_tags: [], synergies: [] };
  }

  // Find other cards sharing those mechanic tags
  const colorFilter = params.color_identity?.length
    ? "AND ALL(ci IN other.color_identity WHERE ci IN $colors)"
    : "";

  const synergies = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (other:Card)-[:HAS_MECHANIC]->(m:MechanicTag)
      WHERE m.name IN $tags
        AND other.name <> $card_name
        AND (other)-[:LEGAL_IN]->(:Format {name: $format})
        ${colorFilter}
      WITH other, collect(DISTINCT m.name) AS shared_tags
      RETURN other.name AS name,
             other.oracle_text AS oracle_text,
             other.mana_cost AS mana_cost,
             other.cmc AS cmc,
             other.type_line AS type_line,
             other.color_identity AS color_identity,
             shared_tags,
             size(shared_tags) AS synergy_score
      ORDER BY synergy_score DESC, other.edhrec_rank ASC
      LIMIT $limit
    `;

    const res = await tx.run(cypher, {
      tags: targetInfo.tags,
      card_name: targetInfo.name,
      format: params.format,
      colors: params.color_identity ?? [],
      limit: neo4jInt(params.limit),
    });

    return res.records.map((record): SynergyResult => {
      const cmc = record.get("cmc");
      return {
        name: record.get("name") as string,
        oracle_text: (record.get("oracle_text") as string) ?? null,
        mana_cost: (record.get("mana_cost") as string) ?? "",
        cmc:
          typeof cmc === "object" && cmc !== null && "toNumber" in cmc
            ? (cmc as { toNumber: () => number }).toNumber()
            : (cmc as number),
        type_line: (record.get("type_line") as string) ?? "",
        color_identity: (record.get("color_identity") as string[]) ?? [],
        shared_tags: record.get("shared_tags") as string[],
        synergy_score:
          typeof record.get("synergy_score") === "object" &&
          record.get("synergy_score") !== null &&
          "toNumber" in (record.get("synergy_score") as object)
            ? (record.get("synergy_score") as { toNumber: () => number }).toNumber()
            : (record.get("synergy_score") as number),
      };
    });
  });

  return {
    target_card: targetInfo.name,
    found: true,
    target_tags: targetInfo.tags,
    synergies,
  };
}

export function registerFindSynergies(server: McpServer): void {
  server.tool(
    "find_synergies",
    "Find cards that share mechanic tags with a given card. " +
      "Returns cards ranked by how many mechanic tags they share (synergy score). " +
      "Use this to discover cards that work well together based on shared mechanics " +
      "like removal, ramp, draw engines, sacrifice outlets, etc.",
    {
      card_name: z.string().describe("The exact name of the card to find synergies for"),
      format: z.string().default("commander").describe(
        "Format to filter legal cards (default: commander)"
      ),
      color_identity: z
        .array(z.enum(["W", "U", "B", "R", "G"]))
        .optional()
        .describe("Restrict results to cards within these colors (e.g. ['B', 'G'] for Golgari)"),
      limit: z.number().min(1).max(25).default(15).describe(
        "Maximum number of synergy results to return (1-25, default: 15)"
      ),
    },
    async (args) => {
      try {
        const result = await findSynergies({
          card_name: args.card_name,
          format: args.format,
          color_identity: args.color_identity,
          limit: args.limit,
        });

        if (!result.found) {
          return {
            content: [{ type: "text" as const, text: `Card "${args.card_name}" not found in the database.` }],
          };
        }

        if (result.target_tags.length === 0) {
          const message = `"${result.target_card}" has no mechanic tags, so synergy scoring isn't available for this card.`;
          return {
            content: [{ type: "text" as const, text: message }],
          };
        }

        if (result.synergies.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No synergistic cards found for "${result.target_card}" in ${args.format} format.` +
                  ` Tags searched: ${result.target_tags.join(", ")}`,
              },
            ],
          };
        }

        const formatted = result.synergies.map((card) => {
          const parts = [
            `**${card.name}** ${card.mana_cost} (synergy score: ${card.synergy_score})`,
            card.type_line,
          ];
          if (card.oracle_text) parts.push(card.oracle_text);
          parts.push(`Shared tags: ${card.shared_tags.join(", ")}`);
          parts.push(`Colors: ${card.color_identity.join(", ") || "Colorless"}`);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Synergies for **${result.target_card}** (tags: ${result.target_tags.join(", ")}):\n\n` +
                formatted.join("\n\n---\n\n"),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("find_synergies error:", message);
        return {
          content: [{ type: "text" as const, text: `Error finding synergies: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
