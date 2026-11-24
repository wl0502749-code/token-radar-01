// The token radar's model, radar-2: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never the ceiling) and adds
// the early radar: pre-token protocols below the watchlist floor that are not a wrapped, staked or
// bridged product of a token that already trades. A protocol is pre-token when its record carries no
// token at all (no market cap, no CoinGecko id, no symbol); the live-token protocols are kept apart
// and shown with the market's own values, never mixed into the ranking.
//
// Implied value is calibrated against the market the snapshot itself records, not a hardcoded
// multiple: the base multiple is the median market-cap-to-TVL ratio of the snapshot's live-token
// protocols, blended with the protocol's own category median where that category has enough live
// protocols to say anything. Then:
//
//   base       = tvl_usd x base_multiple(category)
//   launch     = x 0.75   (a token that does not exist yet is worth less than one that trades)
//   growth     = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   reach      = 1 + min(chains - 1, 4) x 0.02
//   implied    = max(1, round(base x launch x growth x maturity x reach))
//
// Every input is a figure the snapshot carries: TVL, seven-day growth, age since first listing and
// chain count. No protocol name is ever special-cased: the same function scores every row, and the
// dashboard recomputes each row from the same inputs so the page and board.json visibly agree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** The discount on a token that does not exist yet, against one that trades. */
  launch_discount: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  /** Per extra chain, up to four, added to the reach multiplier. */
  reach_per_chain: number;
  reach_max_chains: number;
  /** The live-token ratios kept for calibration, and the live count a category needs. */
  ratio_low: number;
  ratio_high: number;
  category_min_live: number;
  /** The weight of the category median against the global median. */
  category_weight: number;
}

export const MODEL: ModelConstants = {
  launch_discount: 0.75,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  reach_per_chain: 0.02,
  reach_max_chains: 4,
  ratio_low: 0.01,
  ratio_high: 20,
  category_min_live: 4,
  category_weight: 0.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: its live median and how many live protocols set it. */
export interface CategoryCalibration {
  category: string;
  multiple: number;
  live_count: number;
}

/** The calibration the snapshot's live-token protocols give the model. */
export interface Calibration {
  global_multiple: number;
  live_count: number;
  categories: CategoryCalibration[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  is_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    launch_discount: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_gas_usd: number;
  farm_hold_days: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan derived in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  is_watchlist: boolean;
  implied_value_usd: number;
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  reach_multiplier: number;
  farm_gas_usd: number;
  farm_hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; 0 when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The market's own calibration, read from the snapshot: the median market-cap-to-TVL ratio of the
 * live-token protocols (no exchanges, ratios inside the model's band), and the same median per
 * category where a category has enough live protocols to say anything. A category with too few live
 * protocols falls back to the global median, so no row is scored on a sample of one or two.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = live
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .filter((r) => r >= model.ratio_low && r <= model.ratio_high);
  const globalMultiple = round4(median(ratios));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const r = p.mcap_usd! / p.tvl_usd;
    if (r < model.ratio_low || r > model.ratio_high) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(r);
    byCategory.set(p.category, list);
  }
  const categories: CategoryCalibration[] = [];
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length >= model.category_min_live) {
      categories.push({ category, multiple: round4(median(list)), live_count: list.length });
    }
  }
  return { global_multiple: globalMultiple, live_count: ratios.length, categories };
}

/** The base multiple one protocol gets: its category median blended with the global median. */
export function baseMultipleFor(p: SnapshotProtocol, calibration: Calibration, model: ModelConstants = MODEL): number {
  const cat = p.category === null ? undefined : calibration.categories.find((c) => c.category === p.category);
  if (cat === undefined) return calibration.global_multiple;
  return round4(calibration.global_multiple * (1 - model.category_weight) + cat.multiple * model.category_weight);
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  baseMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  reachMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range,
  );
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.reach_max_chains);
  const reachMult = round4(1 + extraChains * model.reach_per_chain);
  const baseMultiple = baseMultipleFor(protocol, calibration, model);
  // The multipliers are rounded before the product, so the dashboard recomputes the same number
  // from the same stored inputs: the page and board.json can never disagree.
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * baseMultiple * model.launch_discount * growthMult * maturityMult * reachMult),
  );
  return { implied, baseMultiple, growthPct, growthMult, maturityMult, reachMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole-word wrapped / staked / staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a protocol name: its staking or custody product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Categories that are a wrapped, staked or bridged product by definition, not a launch candidate. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, by the same rule the house drew its watchlist with. A
 * wrapped or staked product of a token that already trades is not a token that does not exist yet.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibration = calibrate(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever else the rule would say.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    const plan = farmPlan(p, v.age);
    return { p, v, plan };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    is_watchlist: watchlist.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_multiple: s.v.baseMultiple,
      launch_discount: model.launch_discount,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      reach_multiplier: s.v.reachMult,
      age_days: s.v.age,
    },
    farm_gas_usd: s.plan.gas_usd,
    farm_hold_days: s.plan.hold_days,
    farm_steps: s.plan.steps.map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain for the plan's second action, when the protocol runs on more than one. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** The typical cost of one simple transaction on a chain, in US dollars. */
export function gasUsd(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 4;
    case 'Bitcoin':
      return 2;
    case 'Tron':
      return 1;
    case 'Arbitrum':
    case 'Optimism':
    case 'Base':
    case 'Unichain':
    case 'Ink':
    case 'Linea':
    case 'Scroll':
    case 'Mantle':
    case 'Katana':
    case 'Sonic':
    case 'Berachain':
    case 'Monad':
    case 'Plasma':
    case 'Avalanche':
    case 'Blast':
    case 'Mode':
    case 'Zircuit':
    case 'Abstract':
      return 0.3;
    case 'Starknet':
      return 0.2;
    case 'Binance':
      return 0.15;
    case 'Polygon':
    case 'Sui':
    case 'Hyperliquid L1':
    case 'Sei':
    case 'Aptos':
      return 0.05;
    case 'Solana':
      return 0.02;
    default:
      return 1;
  }
}

/** A gas figure as a dollar string: "$4", "$0.30", "$0.02". */
export function gasLabel(chain: string): string {
  const g = gasUsd(chain);
  return Number.isInteger(g) ? `$${g}` : `$${g.toFixed(2)}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the supply position open.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('liquidity manager'))
    return `Deposit $${capital} of USDC into ${name}'s managed liquidity vault on ${chain} and keep the receipt.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL yield vault on ${chain} and keep the shares.`;
  if (c.includes('leveraged farm') || c.includes('farm'))
    return `Open a $${capital} leveraged farming position on ${name} on ${chain} at the lowest leverage it offers.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset through ${name} on ${chain} and hold it.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Deposit $${capital} of BTC into ${name} on ${chain} and hold the receipt it issues.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position in its most liquid market.`;
  if (c.includes('payment') || c.includes('card'))
    return `Top up $${capital} on ${name} on ${chain} and make one real payment with it.`;
  if (c.includes('governance'))
    return `Lock $${capital} into ${name}'s incentive program on ${chain} and keep it locked.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${name}'s CeDeFi vault on ${chain} and keep the shares.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${name} on ${chain} and use its main app once.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action: a different move, so the wallet is not a one-tx farm. */
function secondFor(p: SnapshotProtocol, capital: number, chain: string, secondChain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.round(capital / 5);
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${small} more into a second ${name} vault${secondChain === chain ? '' : ` on ${secondChain}`} so the wallet touches two of its products.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Borrow $${small} against the supply, hold it for a week, then repay it in full.`;
  if (c.includes('index')) return `Rebalance once when the index reweights, or add $${small} on the next rebalance.`;
  if (c.includes('dex')) return `Stake the LP receipt in ${name}'s gauge or rewards contract, or vote once if it runs gauges.`;
  if (c.includes('liquidity manager')) return `Add $${small} to a second ${name} pool on ${chain} and rebalance the range once.`;
  if (c.includes('yield')) return `Compound the first rewards back into the vault, or add $${small} to a second ${name} vault.`;
  if (c.includes('leveraged farm') || c.includes('farm')) return `Harvest the first rewards and restake them instead of selling.`;
  if (c.includes('rwa')) return `Reinvest the first yield payout into the same asset and keep the position.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the hedge, then open a second small position in the opposite direction.`;
  if (c.includes('basis')) return `Check the vault's funding rate weekly and top up $${small} when it turns positive.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the first staking rewards instead of claiming them to the wallet.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc'))
    return `Use the receipt as collateral in a lending market on ${chain} for one small borrow.`;
  if (c.includes('stable')) return `Provide $${small} of the stable asset as liquidity on ${chain} and keep it there.`;
  if (c.includes('insurance')) return `Renew the cover once before it lapses, or buy $${small} of cover on a second pool.`;
  if (c.includes('prediction')) return `Place a second position in a different ${name} market.`;
  if (c.includes('payment') || c.includes('card')) return `Make a second payment of $${small} in a different week.`;
  if (c.includes('governance')) return `Vote on one live proposal with the locked position.`;
  if (c.includes('cedefi')) return `Deposit $${small} into a second ${name} vault on ${chain}.`;
  if (c.includes('chain')) return `Use a second app on ${name} once, such as its swap or its lending market.`;
  return `Make a second deposit of $${small} a week after the first one.`;
}

/** A protocol's whole farm plan: the steps, the total gas estimate and the hold. */
export interface FarmPlan {
  steps: FarmStep[];
  gas_usd: number;
  hold_days: number;
  capital: number;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. The gas total counts every transaction the plan asks for, priced on the protocol's chain.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = chainOf(p);
  const secondChain = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasLabel(chain);
  const weeks = Math.ceil(hold / 7);
  const gasTotal = Math.round(gasUsd(chain) * (3 + weeks + 1) * 100) / 100;
  return {
    steps: [
      {
        text: `Open a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with $${capital} of USDC on ${chain}.`,
        cost: `about ${gas} of gas to fund it`,
        time: '10 minutes',
      },
      {
        text: actionFor(p, capital, chain),
        cost: `$${capital} of capital and about ${gas} of gas`,
        time: '15 minutes to set up',
      },
      {
        text: secondFor(p, capital, chain, secondChain),
        cost: `about ${gas} of gas`,
        time: '10 minutes',
      },
      {
        text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active in every snapshot window.`,
        cost: `about ${gas} of gas a week`,
        time: '10 minutes a week',
      },
      {
        text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
        cost: `the $${capital} stays in the position`,
        time: `${hold} days`,
      },
      {
        text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; then write the wallet, the dates and every transaction in a farm log.`,
        cost: 'no fee to check, and never pay to claim',
        time: '10 minutes',
      },
    ],
    gas_usd: gasTotal,
    hold_days: hold,
    capital,
  };
}

/** The farm steps as strings, as board.json carries them. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  return farmPlan(p, age).steps.map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan derived in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    is_watchlist: row.is_watchlist,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    reach_multiplier: row.model.reach_multiplier,
    farm_gas_usd: row.farm_gas_usd,
    farm_hold_days: row.farm_hold_days,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.is_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration: calibrate(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0)
    throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string'))
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, farm steps, shape. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate wants`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not a protocol the snapshot lists`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
