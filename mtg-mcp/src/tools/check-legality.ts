import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withReadSession } from "../db.js";
import type { LegalityCheckResult } from "../types.js";

interface CheckLegalityParams {
  card_names: string[];
  format: string;
}

interface CheckLegalityResponse {
  format: string;
  results: LegalityCheckResult[];
  summary: { legal: number; restricted: number; not_legal: number; not_found: number };
}

/**
 * Check legality of a list of cards in a given format.
 * Uses LEGAL_IN relationship edges rather than parsing the legalities JSON string.
 */
async function checkLegality(params: CheckLegalityParams): Promise<CheckLegalityResponse> {
  const { card_names, format } = params;

  const results = await withReadSession(async (session) => {
    const { records } = await session.run(
      `
      UNWIND $card_names AS cardName
      OPTIONAL MATCH (c:Card)
        WHERE toLower(c.name) = toLower(cardName)
      OPTIONAL MATCH (c)-[r:LEGAL_IN]->(f:Format)
        WHERE toLower(f.name) = toLower($format)
      RETURN
        cardName,
        c.name AS resolved_name,
        c IS NOT NULL AS found,
        r.status AS status
      `,
      { card_names, format }
    );

    return records.map((record): LegalityCheckResult => {
      const cardName = record.get("cardName") as string;
      const found = record.get("found") as boolean;
      const status = record.get("status") as string | null;
      const resolvedName = record.get("resolved_name") as string | null;

      if (!found) {
        return { card_name: cardName, status: "not_found" };
      }

      if (status === "legal") {
        return { card_name: resolvedName ?? cardName, status: "legal" };
      }

      if (status === "restricted") {
        return { card_name: resolvedName ?? cardName, status: "restricted" };
      }

      return { card_name: resolvedName ?? cardName, status: "not_legal" };
    });
  });

  const summary = {
    legal: results.filter((r) => r.status === "legal").length,
    restricted: results.filter((r) => r.status === "restricted").length,
    not_legal: results.filter((r) => r.status === "not_legal").length,
    not_found: results.filter((r) => r.status === "not_found").length,
  };

  return { format, results, summary };
}

/** Format the legality check response as readable text */
function formatResponse(response: CheckLegalityResponse): string {
  const lines: string[] = [];
  lines.push(`# Legality Check — ${response.format}`);
  lines.push("");

  const statusIcon: Record<string, string> = {
    legal: "✅",
    restricted: "⚠️",
    not_legal: "❌",
    not_found: "❓",
  };

  const statusLabel: Record<string, string> = {
    legal: "Legal",
    restricted: "Restricted",
    not_legal: "Not Legal",
    not_found: "Not Found",
  };

  for (const result of response.results) {
    const icon = statusIcon[result.status] ?? "";
    const label = statusLabel[result.status] ?? result.status;
    lines.push(`${icon} **${result.card_name}** — ${label}`);
  }

  lines.push("");
  const { summary } = response;
  const parts: string[] = [];
  if (summary.legal > 0) parts.push(`${summary.legal} legal`);
  if (summary.restricted > 0) parts.push(`${summary.restricted} restricted`);
  if (summary.not_legal > 0) parts.push(`${summary.not_legal} not legal`);
  if (summary.not_found > 0) parts.push(`${summary.not_found} not found`);
  lines.push(`**Summary:** ${parts.join(", ")} (${response.results.length} total)`);

  return lines.join("\n");
}

/** Register the check_legality tool on the MCP server */
export function registerCheckLegality(server: McpServer): void {
  server.tool(
    "check_legality",
    "Validate a list of card names against format legality. Returns each card's status: legal, restricted, not legal, or not found. Use this to verify a deck list or a set of card picks are legal in a given format.",
    {
      card_names: z.array(z.string()).min(1).max(100).describe(
        "Card names to check (1–100). Names are matched case-insensitively."
      ),
      format: z.string().describe(
        "Format to check against, e.g. 'commander', 'modern', 'standard', 'legacy', 'vintage', 'pauper'"
      ),
    },
    async (params) => {
      try {
        const response = await checkLegality({
          card_names: params.card_names,
          format: params.format,
        });
        return { content: [{ type: "text" as const, text: formatResponse(response) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error checking legality: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
