/** Minimal card representation returned by most tools */
export interface CardResult {
  name: string;
  oracle_text: string | null;
  mana_cost: string;
  cmc: number;
  type_line: string;
  color_identity: string[];
  image_uri?: string;
}

/** Extended card details for the get_card tool */
export interface CardDetail extends CardResult {
  colors: string[];
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  rarity: string;
  set_code: string;
  keywords: string[];
  creature_types: string[];
  card_types: string[];
  mechanic_tags: string[];
  edhrec_rank: number | null;
  produced_mana: string[];
  legalities: Record<string, string>;
}

/** A card with synergy scoring */
export interface SynergyResult extends CardResult {
  shared_tags: string[];
  synergy_score: number;
}

/** A combo involving multiple cards */
export interface ComboResult {
  cards: string[];
  description: string;
}

/** Tribal support categories */
export interface TribalResult {
  lords: CardResult[];
  creatures: CardResult[];
  payoffs: CardResult[];
  enablers: CardResult[];
}

/** Card with mechanic tag matches */
export interface MechanicResult extends CardResult {
  matching_tags: string[];
}

/** Legality check result for a single card */
export interface LegalityCheckResult {
  card_name: string;
  status: "legal" | "restricted" | "not_legal" | "not_found";
}

/** Deck shell category */
export interface DeckShellCategory {
  category: string;
  cards: CardResult[];
}

/** Full deck shell */
export interface DeckShell {
  commander: CardResult;
  strategy: string;
  categories: DeckShellCategory[];
}
