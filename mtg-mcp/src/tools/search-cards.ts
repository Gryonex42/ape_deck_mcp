import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import neo4j from "neo4j-driver";
import { withReadSession } from "../db.js";
import type { CardResult } from "../types.js";

/** Sanitise a query string for Lucene full-text search (escape special chars) */
function sanitiseFullTextQuery(query: string): string {
  // Escape Lucene special characters and wrap each word with wildcards for partial matching
  const escaped = query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, "\\$&");
  return escaped
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word}*`)
    .join(" AND ");
}

interface SearchResult extends CardResult {
  score: number;
}

async function searchCards(params: {
  query: string;
  colors?: string[];
  type?: string;
  cmc_max?: number;
  format: string;
  limit: number;
}): Promise<SearchResult[]> {
  const fullTextQuery = sanitiseFullTextQuery(params.query);
  const lowerQuery = params.query.toLowerCase();

  // Build WHERE filters for both branches
  const formatFilter = `(c)-[:LEGAL_IN]->(:Format {name: $format})`;
  const colorFilter = params.colors?.length ? `ALL(ci IN c.color_identity WHERE ci IN $colors)` : null;
  const typeFilter = params.type ? `(c)-[:HAS_CARD_TYPE]->(:CardType {name: $type})` : null;
  const cmcFilter = params.cmc_max !== undefined ? `c.cmc <= $cmc_max` : null;

  const allFilters = [formatFilter, colorFilter, typeFilter, cmcFilter].filter(Boolean);
  const filterClause = allFilters.join(" AND ");

  // Two separate queries to avoid UNION complexity, then merge client-side
  const oracleResults = await withReadSession(async (tx) => {
    const cypher = `
      CALL db.index.fulltext.queryNodes('card_oracle_text', $fulltext_query)
      YIELD node AS c, score
      WHERE ${filterClause}
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity,
             score
      ORDER BY score DESC
      LIMIT $limit
    `;
    const res = await tx.run(cypher, {
      fulltext_query: fullTextQuery,
      format: params.format,
      colors: params.colors ?? [],
      type: params.type ?? "",
      cmc_max: params.cmc_max !== undefined ? neo4jInt(params.cmc_max) : 999,
      limit: neo4jInt(params.limit),
    });
    return res.records.map(mapRecord);
  });

  const nameResults = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (c:Card)
      WHERE toLower(c.name) CONTAINS $lower_query
      AND ${filterClause}
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity,
             1.0 AS score
      ORDER BY c.edhrec_rank ASC
      LIMIT $limit
    `;
    const res = await tx.run(cypher, {
      lower_query: lowerQuery,
      format: params.format,
      colors: params.colors ?? [],
      type: params.type ?? "",
      cmc_max: params.cmc_max !== undefined ? neo4jInt(params.cmc_max) : 999,
      limit: neo4jInt(params.limit),
    });
    return res.records.map(mapRecord);
  });

  // Merge, deduplicate by name, prefer higher score
  const seen = new Map<string, SearchResult>();
  for (const card of [...nameResults, ...oracleResults]) {
    const existing = seen.get(card.name);
    if (!existing || card.score > existing.score) {
      seen.set(card.name, card);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, params.limit);
}

function neo4jInt(n: number) {
  return neo4j.int(Math.floor(n));
}

function mapRecord(record: { get: (key: string) => unknown }): SearchResult {
  const cmc = record.get("cmc");
  const score = record.get("score");
  return {
    name: record.get("name") as string,
    oracle_text: (record.get("oracle_text") as string) ?? null,
    mana_cost: (record.get("mana_cost") as string) ?? "",
    cmc: typeof cmc === "object" && cmc !== null && "toNumber" in cmc
      ? (cmc as { toNumber: () => number }).toNumber()
      : (cmc as number),
    type_line: (record.get("type_line") as string) ?? "",
    color_identity: (record.get("color_identity") as string[]) ?? [],
    score: typeof score === "number" ? score : Number(score),
  };
}

export function registerSearchCards(server: McpServer): void {
  server.tool(
    "search_cards",
    "Search for Magic: The Gathering cards by name or oracle text. " +
      "Searches both card names (exact substring match) and oracle text (full-text search). " +
      "Use this for broad card discovery — finding cards by what they do, their name, or specific rules text. " +
      "Results include card name, oracle text, mana cost, CMC, type line, and color identity. " +
      "For full details on a specific card, use get_card instead. " +
      "For mechanic-based searches (e.g. 'find me removal spells'), use find_by_mechanic.",
    {
      query: z.string().describe(
        "Search query — matches against card name and oracle text"
      ),
      colors: z.array(z.enum(["W", "U", "B", "R", "G"])).optional().describe(
        "Filter by color identity (cards must fit within these colors). Example: ['W', 'U'] for white/blue"
      ),
      type: z.string().optional().describe(
        "Filter by card type (e.g. 'Creature', 'Instant', 'Sorcery', 'Enchantment', 'Artifact')"
      ),
      cmc_max: z.number().optional().describe(
        "Maximum mana value (converted mana cost)"
      ),
      format: z.string().default("commander").describe(
        "Format to check legality for (default: commander)"
      ),
      limit: z.number().min(1).max(25).default(10).describe(
        "Maximum number of results to return (1-25, default: 10)"
      ),
    },
    async (args) => {
      try {
        const results = await searchCards({
          query: args.query,
          colors: args.colors,
          type: args.type,
          cmc_max: args.cmc_max,
          format: args.format,
          limit: args.limit,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No cards found matching "${args.query}" in ${args.format} format.`,
              },
            ],
          };
        }

        const formatted = results.map((card) => {
          const parts = [`**${card.name}** ${card.mana_cost}`, card.type_line];
          if (card.oracle_text) parts.push(card.oracle_text);
          parts.push(`CMC: ${card.cmc} | Colors: ${card.color_identity.join(", ") || "Colorless"}`);
          return parts.join("\n");
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${results.length} card(s) matching "${args.query}":\n\n${formatted.join("\n\n---\n\n")}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("search_cards error:", message);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching cards: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
