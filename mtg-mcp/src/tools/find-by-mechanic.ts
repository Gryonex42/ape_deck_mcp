import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import neo4j from "neo4j-driver";
import { withReadSession } from "../db.js";
import type { MechanicResult } from "../types.js";

function neo4jInt(n: number) {
  return neo4j.int(Math.floor(n));
}

async function findByMechanic(params: {
  tags: string[];
  colors?: string[];
  cmc_max?: number;
  format: string;
  limit: number;
}): Promise<{ matched_tags: string[]; cards: MechanicResult[] }> {
  // Resolve tag names: exact match first, then CONTAINS match for broader terms
  const resolvedTags = await withReadSession(async (tx) => {
    const res = await tx.run(
      `
      MATCH (m:MechanicTag)
      WHERE m.name IN $exact_tags
         OR ANY(term IN $search_terms WHERE m.name CONTAINS term)
      RETURN m.name AS tag_name
      `,
      {
        exact_tags: params.tags,
        search_terms: params.tags.map((t) => t.toLowerCase()),
      }
    );
    return res.records.map((r) => r.get("tag_name") as string);
  });

  if (resolvedTags.length === 0) {
    return { matched_tags: [], cards: [] };
  }

  // Build filters
  const colorFilter = params.colors?.length
    ? "AND ALL(ci IN c.color_identity WHERE ci IN $colors)"
    : "";
  const cmcFilter = params.cmc_max !== undefined ? "AND c.cmc <= $cmc_max" : "";

  const cards = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (c:Card)-[:HAS_MECHANIC]->(m:MechanicTag)
      WHERE m.name IN $tags
        AND (c)-[:LEGAL_IN]->(:Format {name: $format})
        ${colorFilter}
        ${cmcFilter}
      WITH c, collect(DISTINCT m.name) AS matching_tags
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity,
             matching_tags
      ORDER BY size(matching_tags) DESC, c.edhrec_rank ASC
      LIMIT $limit
    `;

    const res = await tx.run(cypher, {
      tags: resolvedTags,
      format: params.format,
      colors: params.colors ?? [],
      cmc_max: params.cmc_max !== undefined ? neo4jInt(params.cmc_max) : 999,
      limit: neo4jInt(params.limit),
    });

    return res.records.map((record): MechanicResult => {
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
        matching_tags: record.get("matching_tags") as string[],
      };
    });
  });

  return { matched_tags: resolvedTags, cards };
}

export function registerFindByMechanic(server: McpServer): void {
  server.tool(
    "find_by_mechanic",
    "Find cards by mechanic tag names. " +
      "Tags are functional labels like 'removal-exile', 'mana dork', 'draw engine', 'sacrifice outlet-creature', 'ramp', etc. " +
      "You can also pass broader terms like 'removal' to match all tags containing that term " +
      "(e.g. 'removal' matches 'removal-exile', 'removal-creature', 'removal-destroy', etc.). " +
      "Use this to find cards that serve a specific role in a deck.",
    {
      tags: z
        .array(z.string())
        .min(1)
        .describe(
          "Tag names or search terms to match. Exact tag names (e.g. 'removal-exile') or broader terms " +
            "(e.g. 'removal' matches all removal-* tags). Common tags: ramp, draw, removal, sacrifice, " +
            "lifegain, counterspell, sweeper, reanimates, tutor, evasion, token"
        ),
      colors: z
        .array(z.enum(["W", "U", "B", "R", "G"]))
        .optional()
        .describe("Filter by color identity (cards must fit within these colors)"),
      cmc_max: z.number().optional().describe("Maximum mana value (converted mana cost)"),
      format: z.string().default("commander").describe(
        "Format to check legality for (default: commander)"
      ),
      limit: z.number().min(1).max(25).default(15).describe(
        "Maximum number of results to return (1-25, default: 15)"
      ),
    },
    async (args) => {
      try {
        const result = await findByMechanic({
          tags: args.tags,
          colors: args.colors,
          cmc_max: args.cmc_max,
          format: args.format,
          limit: args.limit,
        });

        if (result.matched_tags.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No mechanic tags found matching: ${args.tags.join(", ")}. ` +
                  "Try broader terms like 'removal', 'draw', 'ramp', 'sacrifice', or exact tag names.",
              },
            ],
          };
        }

        if (result.cards.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Matched tags (${result.matched_tags.join(", ")}) but no cards found ` +
                  `in ${args.format} format with the current filters.`,
              },
            ],
          };
        }

        const formatted = result.cards.map((card) => {
          const parts = [`**${card.name}** ${card.mana_cost}`, card.type_line];
          if (card.oracle_text) parts.push(card.oracle_text);
          parts.push(`Tags: ${card.matching_tags.join(", ")}`);
          parts.push(`CMC: ${card.cmc} | Colors: ${card.color_identity.join(", ") || "Colorless"}`);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${result.cards.length} card(s) matching tags (${result.matched_tags.join(", ")}):\n\n` +
                formatted.join("\n\n---\n\n"),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("find_by_mechanic error:", message);
        return {
          content: [{ type: "text" as const, text: `Error finding cards by mechanic: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
