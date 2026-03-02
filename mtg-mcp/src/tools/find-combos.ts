import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import neo4j from "neo4j-driver";
import { withReadSession } from "../db.js";
import type { CardResult } from "../types.js";

function neo4jInt(n: number) {
  return neo4j.int(Math.floor(n));
}

/** A combo partner card with context about why it combos */
interface ComboPartner extends CardResult {
  combo_type: "enabler_payoff" | "co_enabler" | "complementary";
  mechanic: string;
  reason: string;
}

/**
 * Complementary tag-name patterns: if a card has a tag matching the key,
 * look for other cards whose tags match any of the complementary terms.
 * These represent the "other half" of a mechanical interaction.
 */
const COMPLEMENTARY_PATTERNS: Array<{ trigger: string; complements: string[]; reason: string }> = [
  {
    trigger: "sacrifice",
    complements: ["death", "dies", "graveyard", "reanimate"],
    reason: "Sacrifice outlets pair with death triggers and graveyard recursion",
  },
  {
    trigger: "blink",
    complements: ["etb", "enters", "enter"],
    reason: "Blink/flicker effects reuse ETB triggers",
  },
  {
    trigger: "flicker",
    complements: ["etb", "enters", "enter"],
    reason: "Blink/flicker effects reuse ETB triggers",
  },
  {
    trigger: "etb",
    complements: ["blink", "flicker", "bounce"],
    reason: "ETB triggers are reused by blink and bounce effects",
  },
  {
    trigger: "untap",
    complements: ["tap", "activated"],
    reason: "Untap effects let you reuse tap abilities",
  },
  {
    trigger: "counter",
    complements: ["proliferate", "counter"],
    reason: "Counters synergise with proliferate and other counter manipulators",
  },
  {
    trigger: "token",
    complements: ["sacrifice", "anthem", "populate", "convoke"],
    reason: "Token generators feed sacrifice outlets and benefit from anthems",
  },
  {
    trigger: "reanimate",
    complements: ["mill", "discard", "graveyard", "sacrifice"],
    reason: "Reanimation needs cards in the graveyard via sacrifice, mill, or discard",
  },
  {
    trigger: "discard",
    complements: ["madness", "graveyard", "reanimate", "dredge"],
    reason: "Discard fuels madness, graveyard strategies, and reanimation",
  },
  {
    trigger: "draw",
    complements: ["discard", "madness", "hand size"],
    reason: "Draw engines enable discard synergies and hand-size-matters effects",
  },
  {
    trigger: "mill",
    complements: ["reanimate", "graveyard", "flashback", "delve"],
    reason: "Mill fills the graveyard for reanimation and delve",
  },
  {
    trigger: "lifegain",
    complements: ["life loss", "life pay", "drain"],
    reason: "Lifegain recovers life spent by life-payment and drain effects",
  },
];

interface TargetInfo {
  name: string;
  tags: string[];
  enables: string[];
  payoffs: string[];
}

async function findCombos(params: {
  card_name: string;
  format: string;
  color_identity?: string[];
  limit: number;
}): Promise<{
  target_card: string;
  found: boolean;
  target_roles: { tags: string[]; enables: string[]; payoffs: string[] };
  combos: ComboPartner[];
}> {
  // Gather target card's full mechanic ecosystem
  const targetInfo = await withReadSession(async (tx) => {
    const res = await tx.run(
      `
      MATCH (c:Card)
      WHERE toLower(c.name) = toLower($card_name)
      OPTIONAL MATCH (c)-[:HAS_MECHANIC]->(m:MechanicTag)
      OPTIONAL MATCH (c)-[:ENABLER_FOR]->(e:MechanicTag)
      OPTIONAL MATCH (c)-[:PAYOFF_FOR]->(p:MechanicTag)
      RETURN c.name AS name,
             collect(DISTINCT m.name) AS tags,
             collect(DISTINCT e.name) AS enables,
             collect(DISTINCT p.name) AS payoffs
      LIMIT 1
      `,
      { card_name: params.card_name }
    );
    if (res.records.length === 0) return null;
    const record = res.records[0];
    return {
      name: record.get("name") as string,
      tags: record.get("tags") as string[],
      enables: record.get("enables") as string[],
      payoffs: record.get("payoffs") as string[],
    } satisfies TargetInfo;
  });

  if (!targetInfo) {
    return {
      target_card: params.card_name,
      found: false,
      target_roles: { tags: [], enables: [], payoffs: [] },
      combos: [],
    };
  }

  const hasAnyData = targetInfo.tags.length > 0 || targetInfo.enables.length > 0 || targetInfo.payoffs.length > 0;
  if (!hasAnyData) {
    return {
      target_card: targetInfo.name,
      found: true,
      target_roles: { tags: [], enables: [], payoffs: [] },
      combos: [],
    };
  }

  const colorFilter = params.color_identity?.length
    ? "AND ALL(ci IN partner.color_identity WHERE ci IN $colors)"
    : "";

  const allCombos: ComboPartner[] = [];

  // ── Query 1: Enabler↔Payoff combos ──────────────────────────────────
  if (targetInfo.enables.length > 0 || targetInfo.payoffs.length > 0) {
    // If target enables X → find payoffs for X
    if (targetInfo.enables.length > 0) {
      const payoffPartners = await withReadSession(async (tx) => {
        const cypher = `
          MATCH (target:Card {name: $card_name})-[:ENABLER_FOR]->(m:MechanicTag)<-[:PAYOFF_FOR]-(partner:Card)
          WHERE partner.name <> $card_name
            AND (partner)-[:LEGAL_IN]->(:Format {name: $format})
            ${colorFilter}
          RETURN partner.name AS name,
                 partner.oracle_text AS oracle_text,
                 partner.mana_cost AS mana_cost,
                 partner.cmc AS cmc,
                 partner.type_line AS type_line,
                 partner.color_identity AS color_identity,
                 m.name AS mechanic
          LIMIT $limit
        `;
        const res = await tx.run(cypher, {
          card_name: targetInfo.name,
          format: params.format,
          colors: params.color_identity ?? [],
          limit: neo4jInt(params.limit),
        });
        return res.records.map((record): ComboPartner => ({
          name: record.get("name") as string,
          oracle_text: (record.get("oracle_text") as string) ?? null,
          mana_cost: (record.get("mana_cost") as string) ?? "",
          cmc: toNumber(record.get("cmc")),
          type_line: (record.get("type_line") as string) ?? "",
          color_identity: (record.get("color_identity") as string[]) ?? [],
          combo_type: "enabler_payoff",
          mechanic: record.get("mechanic") as string,
          reason: `This card pays off "${record.get("mechanic")}" which your card enables`,
        }));
      });
      allCombos.push(...payoffPartners);
    }

    // If target pays off X → find enablers for X
    if (targetInfo.payoffs.length > 0) {
      const enablerPartners = await withReadSession(async (tx) => {
        const cypher = `
          MATCH (target:Card {name: $card_name})-[:PAYOFF_FOR]->(m:MechanicTag)<-[:ENABLER_FOR]-(partner:Card)
          WHERE partner.name <> $card_name
            AND (partner)-[:LEGAL_IN]->(:Format {name: $format})
            ${colorFilter}
          RETURN partner.name AS name,
                 partner.oracle_text AS oracle_text,
                 partner.mana_cost AS mana_cost,
                 partner.cmc AS cmc,
                 partner.type_line AS type_line,
                 partner.color_identity AS color_identity,
                 m.name AS mechanic
          LIMIT $limit
        `;
        const res = await tx.run(cypher, {
          card_name: targetInfo.name,
          format: params.format,
          colors: params.color_identity ?? [],
          limit: neo4jInt(params.limit),
        });
        return res.records.map((record): ComboPartner => ({
          name: record.get("name") as string,
          oracle_text: (record.get("oracle_text") as string) ?? null,
          mana_cost: (record.get("mana_cost") as string) ?? "",
          cmc: toNumber(record.get("cmc")),
          type_line: (record.get("type_line") as string) ?? "",
          color_identity: (record.get("color_identity") as string[]) ?? [],
          combo_type: "enabler_payoff",
          mechanic: record.get("mechanic") as string,
          reason: `This card enables "${record.get("mechanic")}" which your card pays off`,
        }));
      });
      allCombos.push(...enablerPartners);
    }
  }

  // ── Query 2: Co-enabler combos ──────────────────────────────────────
  if (targetInfo.enables.length > 0) {
    const coEnablers = await withReadSession(async (tx) => {
      const cypher = `
        MATCH (target:Card {name: $card_name})-[:ENABLER_FOR]->(m:MechanicTag)<-[:ENABLER_FOR]-(partner:Card)
        WHERE partner.name <> $card_name
          AND (partner)-[:LEGAL_IN]->(:Format {name: $format})
          ${colorFilter}
        RETURN partner.name AS name,
               partner.oracle_text AS oracle_text,
               partner.mana_cost AS mana_cost,
               partner.cmc AS cmc,
               partner.type_line AS type_line,
               partner.color_identity AS color_identity,
               m.name AS mechanic
        LIMIT $limit
      `;

      const res = await tx.run(cypher, {
        card_name: targetInfo.name,
        format: params.format,
        colors: params.color_identity ?? [],
        limit: neo4jInt(params.limit),
      });

      return res.records.map((record): ComboPartner => ({
        name: record.get("name") as string,
        oracle_text: (record.get("oracle_text") as string) ?? null,
        mana_cost: (record.get("mana_cost") as string) ?? "",
        cmc: toNumber(record.get("cmc")),
        type_line: (record.get("type_line") as string) ?? "",
        color_identity: (record.get("color_identity") as string[]) ?? [],
        combo_type: "co_enabler",
        mechanic: record.get("mechanic") as string,
        reason: `Both cards enable "${record.get("mechanic")}" — they work together in the same strategy`,
      }));
    });
    allCombos.push(...coEnablers);
  }

  // ── Query 3: Complementary tag combos ───────────────────────────────
  const complementaryTerms = findComplementaryTerms(targetInfo.tags);
  if (complementaryTerms.length > 0) {
    const seenNames = new Set(allCombos.map((c) => c.name));
    seenNames.add(targetInfo.name);

    const complementaryCombos = await withReadSession(async (tx) => {
      const cypher = `
        MATCH (partner:Card)-[:HAS_MECHANIC]->(m:MechanicTag)
        WHERE ANY(term IN $complement_terms WHERE m.name CONTAINS term)
          AND NOT partner.name IN $exclude_names
          AND (partner)-[:LEGAL_IN]->(:Format {name: $format})
          ${colorFilter}
        WITH partner, collect(DISTINCT m.name) AS matched_tags
        RETURN partner.name AS name,
               partner.oracle_text AS oracle_text,
               partner.mana_cost AS mana_cost,
               partner.cmc AS cmc,
               partner.type_line AS type_line,
               partner.color_identity AS color_identity,
               matched_tags
        ORDER BY size(matched_tags) DESC, partner.edhrec_rank ASC
        LIMIT $limit
      `;

      const res = await tx.run(cypher, {
        complement_terms: complementaryTerms.map((ct) => ct.term),
        exclude_names: [...seenNames],
        format: params.format,
        colors: params.color_identity ?? [],
        limit: neo4jInt(params.limit),
      });

      return res.records.map((record): ComboPartner => {
        const matchedTags = record.get("matched_tags") as string[];
        // Find the best matching reason
        const reason = findBestReason(matchedTags, complementaryTerms);
        return {
          name: record.get("name") as string,
          oracle_text: (record.get("oracle_text") as string) ?? null,
          mana_cost: (record.get("mana_cost") as string) ?? "",
          cmc: toNumber(record.get("cmc")),
          type_line: (record.get("type_line") as string) ?? "",
          color_identity: (record.get("color_identity") as string[]) ?? [],
          combo_type: "complementary",
          mechanic: matchedTags.join(", "),
          reason,
        };
      });
    });
    allCombos.push(...complementaryCombos);
  }

  // Deduplicate by card name, preferring higher-confidence combo types
  const deduped = deduplicateCombos(allCombos);

  return {
    target_card: targetInfo.name,
    found: true,
    target_roles: {
      tags: targetInfo.tags,
      enables: targetInfo.enables,
      payoffs: targetInfo.payoffs,
    },
    combos: deduped.slice(0, params.limit),
  };
}

/** Extract complementary search terms from a card's mechanic tags */
function findComplementaryTerms(tags: string[]): Array<{ term: string; reason: string }> {
  const terms: Array<{ term: string; reason: string }> = [];
  const seenTerms = new Set<string>();

  for (const tag of tags) {
    const tagLower = tag.toLowerCase();
    for (const pattern of COMPLEMENTARY_PATTERNS) {
      if (tagLower.includes(pattern.trigger)) {
        for (const complement of pattern.complements) {
          if (!seenTerms.has(complement)) {
            seenTerms.add(complement);
            terms.push({ term: complement, reason: pattern.reason });
          }
        }
      }
    }
  }
  return terms;
}

/** Find the best reason from complementary terms for a set of matched tags */
function findBestReason(
  matchedTags: string[],
  complementaryTerms: Array<{ term: string; reason: string }>
): string {
  for (const ct of complementaryTerms) {
    if (matchedTags.some((tag) => tag.toLowerCase().includes(ct.term))) {
      return ct.reason;
    }
  }
  return "Mechanic tags suggest complementary gameplay";
}

/** Parse a combo partner from a Neo4j map result */
function parseComboPartner(r: Record<string, unknown>): ComboPartner {
  return {
    name: r.name as string,
    oracle_text: (r.oracle_text as string) ?? null,
    mana_cost: (r.mana_cost as string) ?? "",
    cmc: toNumber(r.cmc),
    type_line: (r.type_line as string) ?? "",
    color_identity: (r.color_identity as string[]) ?? [],
    combo_type: r.combo_type as ComboPartner["combo_type"],
    mechanic: r.mechanic as string,
    reason: r.reason as string,
  };
}

/** Safely convert Neo4j integer or JS number */
function toNumber(val: unknown): number {
  if (typeof val === "object" && val !== null && "toNumber" in val) {
    return (val as { toNumber: () => number }).toNumber();
  }
  return val as number;
}

/** Deduplicate combos by card name, preferring higher-confidence types */
function deduplicateCombos(combos: ComboPartner[]): ComboPartner[] {
  const priority: Record<string, number> = {
    enabler_payoff: 3,
    co_enabler: 2,
    complementary: 1,
  };
  const byName = new Map<string, ComboPartner>();
  for (const combo of combos) {
    const existing = byName.get(combo.name);
    if (!existing || priority[combo.combo_type] > priority[existing.combo_type]) {
      byName.set(combo.name, combo);
    }
  }
  // Sort: enabler_payoff first, then co_enabler, then complementary
  return [...byName.values()].sort(
    (a, b) => priority[b.combo_type] - priority[a.combo_type]
  );
}

function formatComboType(type: ComboPartner["combo_type"]): string {
  switch (type) {
    case "enabler_payoff":
      return "Enabler↔Payoff";
    case "co_enabler":
      return "Strategy Partner";
    case "complementary":
      return "Complementary Mechanic";
  }
}

export function registerFindCombos(server: McpServer): void {
  server.tool(
    "find_combos",
    "Find combo partners for a given card based on mechanical interactions. " +
      "Discovers cards that form functional pairs through three strategies: " +
      "(1) enabler↔payoff pairings — cards that enable what the other pays off for, " +
      "(2) co-enablers — cards that enable the same mechanic and work together, " +
      "(3) complementary mechanics — cards whose tags suggest the other half of a combo " +
      "(e.g. sacrifice outlets pair with death triggers, blink pairs with ETB). " +
      "Use this after find_synergies to discover deeper mechanical interactions.",
    {
      card_name: z.string().describe("The exact name of the card to find combos for"),
      format: z.string().default("commander").describe(
        "Format to filter legal cards (default: commander)"
      ),
      color_identity: z
        .array(z.enum(["W", "U", "B", "R", "G"]))
        .optional()
        .describe("Restrict results to cards within these colors (e.g. ['B', 'G'] for Golgari)"),
      limit: z.number().min(1).max(25).default(10).describe(
        "Maximum number of combo partners to return (1-25, default: 10)"
      ),
    },
    async (args) => {
      try {
        const result = await findCombos({
          card_name: args.card_name,
          format: args.format,
          color_identity: args.color_identity,
          limit: args.limit,
        });

        if (!result.found) {
          return {
            content: [{
              type: "text" as const,
              text: `Card "${args.card_name}" not found in the database.`,
            }],
          };
        }

        const { tags, enables, payoffs } = result.target_roles;
        if (tags.length === 0 && enables.length === 0 && payoffs.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `"${result.target_card}" has no mechanic tags or enabler/payoff roles, ` +
                "so combo discovery isn't available for this card. " +
                "Try search_cards or find_by_mechanic instead.",
            }],
          };
        }

        if (result.combos.length === 0) {
          const roles: string[] = [];
          if (tags.length > 0) roles.push(`Tags: ${tags.join(", ")}`);
          if (enables.length > 0) roles.push(`Enables: ${enables.join(", ")}`);
          if (payoffs.length > 0) roles.push(`Pays off: ${payoffs.join(", ")}`);
          return {
            content: [{
              type: "text" as const,
              text: `No combo partners found for "${result.target_card}" in ${args.format} format.\n` +
                `Card roles: ${roles.join(" | ")}`,
            }],
          };
        }

        // Build header with target card roles
        const roleLines: string[] = [];
        if (tags.length > 0) roleLines.push(`Mechanic tags: ${tags.join(", ")}`);
        if (enables.length > 0) roleLines.push(`Enables: ${enables.join(", ")}`);
        if (payoffs.length > 0) roleLines.push(`Pays off: ${payoffs.join(", ")}`);

        const header =
          `Combo partners for **${result.target_card}**\n${roleLines.join("\n")}\n\n` +
          `Found ${result.combos.length} combo partner(s):`;

        const formatted = result.combos.map((card) => {
          const parts = [
            `**${card.name}** ${card.mana_cost} [${formatComboType(card.combo_type)}]`,
            card.type_line,
          ];
          if (card.oracle_text) parts.push(card.oracle_text);
          parts.push(`Mechanic: ${card.mechanic}`);
          parts.push(`Why: ${card.reason}`);
          parts.push(`CMC: ${card.cmc} | Colors: ${card.color_identity.join(", ") || "Colorless"}`);
          return parts.join("\n");
        });

        return {
          content: [{
            type: "text" as const,
            text: header + "\n\n" + formatted.join("\n\n---\n\n"),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("find_combos error:", message);
        return {
          content: [{ type: "text" as const, text: `Error finding combos: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
