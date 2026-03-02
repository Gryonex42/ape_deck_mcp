import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import neo4j from "neo4j-driver";
import { withReadSession } from "../db.js";
import type { CardResult } from "../types.js";

function neo4jInt(n: number) {
  return neo4j.int(Math.floor(n));
}

/** A lord card with its buff description */
interface TribalLord extends CardResult {
  buff: string;
}

/** Parse a Neo4j integer or plain number into a JS number */
function toNumber(val: unknown): number {
  if (typeof val === "object" && val !== null && "toNumber" in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return val as number;
}

/** Build a card result from a Neo4j record */
function toCardResult(record: {
  get: (key: string) => unknown;
}): CardResult {
  return {
    name: record.get("name") as string,
    oracle_text: (record.get("oracle_text") as string) ?? null,
    mana_cost: (record.get("mana_cost") as string) ?? "",
    cmc: toNumber(record.get("cmc")),
    type_line: (record.get("type_line") as string) ?? "",
    color_identity: (record.get("color_identity") as string[]) ?? [],
  };
}

interface FindTribalParams {
  creature_type: string;
  color_identity?: string[];
  format: string;
  limit: number;
}

interface FindTribalResult {
  creature_type: string;
  found: boolean;
  lords: TribalLord[];
  creatures: CardResult[];
  support: CardResult[];
}

async function findTribal(params: FindTribalParams): Promise<FindTribalResult> {
  const colorFilter = params.color_identity?.length
    ? "AND ALL(ci IN c.color_identity WHERE ci IN $colors)"
    : "";

  // Check if the creature type exists
  const typeExists = await withReadSession(async (tx) => {
    const res = await tx.run(
      `MATCH (ct:CreatureType {name: $creature_type}) RETURN ct.name AS name LIMIT 1`,
      { creature_type: params.creature_type }
    );
    return res.records.length > 0;
  });

  if (!typeExists) {
    // Try case-insensitive match
    const fuzzyMatch = await withReadSession(async (tx) => {
      const res = await tx.run(
        `MATCH (ct:CreatureType)
         WHERE toLower(ct.name) = toLower($creature_type)
         RETURN ct.name AS name LIMIT 1`,
        { creature_type: params.creature_type }
      );
      if (res.records.length > 0) {
        return res.records[0].get("name") as string;
      }
      return null;
    });

    if (!fuzzyMatch) {
      return {
        creature_type: params.creature_type,
        found: false,
        lords: [],
        creatures: [],
        support: [],
      };
    }

    // Use the correctly-cased name going forward
    params.creature_type = fuzzyMatch;
  }

  // Strategy 1: Find lords via TRIBAL_LORD_OF
  const lords = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (c:Card)-[r:TRIBAL_LORD_OF]->(ct:CreatureType {name: $creature_type})
      WHERE (c)-[:LEGAL_IN]->(:Format {name: $format})
        ${colorFilter}
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity,
             r.buff AS buff
      ORDER BY c.edhrec_rank ASC
      LIMIT $limit
    `;

    const res = await tx.run(cypher, {
      creature_type: params.creature_type,
      format: params.format,
      colors: params.color_identity ?? [],
      limit: neo4jInt(params.limit),
    });

    return res.records.map((record): TribalLord => ({
      ...toCardResult(record),
      buff: (record.get("buff") as string) ?? "",
    }));
  });

  // Strategy 2: Find creatures of this type (excluding lords to avoid duplication)
  const lordNames = lords.map((l) => l.name);
  const creatures = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (c:Card)-[:HAS_CREATURE_TYPE]->(ct:CreatureType {name: $creature_type})
      WHERE (c)-[:LEGAL_IN]->(:Format {name: $format})
        AND NOT c.name IN $exclude_names
        ${colorFilter}
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity
      ORDER BY c.edhrec_rank ASC
      LIMIT $limit
    `;

    const res = await tx.run(cypher, {
      creature_type: params.creature_type,
      format: params.format,
      colors: params.color_identity ?? [],
      exclude_names: lordNames,
      limit: neo4jInt(params.limit),
    });

    return res.records.map(toCardResult);
  });

  // Strategy 3: Find non-creature support cards that reference the type in oracle text
  // These are cards like "All Zombies get +1/+1" that aren't Zombies themselves
  const allFoundNames = [...lordNames, ...creatures.map((c) => c.name)];
  const support = await withReadSession(async (tx) => {
    const cypher = `
      MATCH (c:Card)
      WHERE toLower(c.oracle_text) CONTAINS toLower($creature_type)
        AND NOT (c)-[:HAS_CREATURE_TYPE]->(:CreatureType {name: $creature_type})
        AND NOT c.name IN $exclude_names
        AND (c)-[:LEGAL_IN]->(:Format {name: $format})
        ${colorFilter}
      RETURN c.name AS name,
             c.oracle_text AS oracle_text,
             c.mana_cost AS mana_cost,
             c.cmc AS cmc,
             c.type_line AS type_line,
             c.color_identity AS color_identity
      ORDER BY c.edhrec_rank ASC
      LIMIT $limit
    `;

    const res = await tx.run(cypher, {
      creature_type: params.creature_type,
      format: params.format,
      colors: params.color_identity ?? [],
      exclude_names: allFoundNames,
      limit: neo4jInt(params.limit),
    });

    return res.records.map(toCardResult);
  });

  return {
    creature_type: params.creature_type,
    found: true,
    lords,
    creatures,
    support,
  };
}

function formatLord(card: TribalLord): string {
  const parts = [
    `**${card.name}** ${card.mana_cost}`,
    card.type_line,
  ];
  if (card.buff) parts.push(`Buff: ${card.buff}`);
  if (card.oracle_text) parts.push(card.oracle_text);
  parts.push(`Colors: ${card.color_identity.join(", ") || "Colorless"}`);
  return parts.join("\n");
}

function formatCard(card: CardResult): string {
  const parts = [
    `**${card.name}** ${card.mana_cost}`,
    card.type_line,
  ];
  if (card.oracle_text) parts.push(card.oracle_text);
  parts.push(`Colors: ${card.color_identity.join(", ") || "Colorless"}`);
  return parts.join("\n");
}

export function registerFindTribal(server: McpServer): void {
  server.tool(
    "find_tribal",
    "Find tribal lords, creatures, and support cards for a creature type. " +
      "Returns three categories: lords (cards with TRIBAL_LORD_OF that buff the type), " +
      "top creatures of that type (ranked by EDHREC popularity), and support cards " +
      "(non-member cards that reference the type in their text, like anthems or token makers). " +
      "Use this when building a tribal deck or looking for cards that care about a specific creature type.",
    {
      creature_type: z.string().describe(
        "The creature type to search for (e.g. 'Zombie', 'Elf', 'Dragon', 'Goblin')"
      ),
      color_identity: z
        .array(z.enum(["W", "U", "B", "R", "G"]))
        .optional()
        .describe("Restrict results to cards within these colors (e.g. ['B', 'G'] for Golgari)"),
      format: z.string().default("commander").describe(
        "Format to filter legal cards (default: commander)"
      ),
      limit: z.number().min(1).max(25).default(10).describe(
        "Maximum number of results per category — lords, creatures, and support (1-25, default: 10)"
      ),
    },
    async (args) => {
      try {
        const result = await findTribal({
          creature_type: args.creature_type,
          color_identity: args.color_identity,
          format: args.format,
          limit: args.limit,
        });

        if (!result.found) {
          return {
            content: [{
              type: "text" as const,
              text: `Creature type "${args.creature_type}" not found in the database. ` +
                `Try common types like Zombie, Elf, Goblin, Dragon, Vampire, etc.`,
            }],
          };
        }

        const sections: string[] = [];
        sections.push(`# Tribal Support for ${result.creature_type}\n`);

        // Lords section
        if (result.lords.length > 0) {
          sections.push(`## Lords (${result.lords.length})\n`);
          sections.push(result.lords.map(formatLord).join("\n\n---\n\n"));
        } else {
          sections.push(`## Lords\nNo tribal lords found for ${result.creature_type} in ${args.format} format.`);
        }

        // Creatures section
        if (result.creatures.length > 0) {
          sections.push(`\n## Top Creatures (${result.creatures.length})\n`);
          sections.push(result.creatures.map(formatCard).join("\n\n---\n\n"));
        } else {
          sections.push(`\n## Top Creatures\nNo ${result.creature_type} creatures found in ${args.format} format.`);
        }

        // Support section
        if (result.support.length > 0) {
          sections.push(`\n## Support Cards (${result.support.length})\n`);
          sections.push(result.support.map(formatCard).join("\n\n---\n\n"));
        } else {
          sections.push(`\n## Support Cards\nNo support cards found for ${result.creature_type} in ${args.format} format.`);
        }

        return {
          content: [{ type: "text" as const, text: sections.join("\n") }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("find_tribal error:", message);
        return {
          content: [{ type: "text" as const, text: `Error finding tribal support: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
