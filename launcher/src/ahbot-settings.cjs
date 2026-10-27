'use strict';
// The auction house bot's simple settings (mod_ahbot.conf): seven choices a player understands, each written as one
// or a few keys of the module. Only these keys are ever written: the rest of the file (the 3 765 CoA prices of
// CompleteItemValueOverride.Items among them) stays as it is.
const confValue = (text, key) => new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*"?([^"\\r\\n#]*)"?`, 'm').exec(text || '')?.[1]?.trim();

const PACES = {
  slow: { 'AuctionHouseBot.MinutesBetweenBuyCycle': '5:15', 'AuctionHouseBot.Buyer.BuyCandidatesPerBuyCycle': '1' },
  normal: { 'AuctionHouseBot.MinutesBetweenBuyCycle': '1:3', 'AuctionHouseBot.Buyer.BuyCandidatesPerBuyCycle': '3' },
  fast: { 'AuctionHouseBot.MinutesBetweenBuyCycle': '1', 'AuctionHouseBot.Buyer.BuyCandidatesPerBuyCycle': '5' },
};
const SIZES = {
  small: { 'AuctionHouseBot.Alliance.MaxItems': '700', 'AuctionHouseBot.Horde.MaxItems': '700', 'AuctionHouseBot.Neutral.MaxItems': '100' },
  normal: { 'AuctionHouseBot.Alliance.MaxItems': '1400', 'AuctionHouseBot.Horde.MaxItems': '1400', 'AuctionHouseBot.Neutral.MaxItems': '200' },
  large: { 'AuctionHouseBot.Alliance.MaxItems': '2800', 'AuctionHouseBot.Horde.MaxItems': '2800', 'AuctionHouseBot.Neutral.MaxItems': '400' },
};
const INSTANT = 'AuctionHouseBot.Buyer.InstantBids';
// Above 68 %, a player can buy from the seller bot (≥ 0.85 × estimate) and sell back to the buyer (≤ 1.25 × estimate
// × this) at a profit.
const SAFE_PRICE = 68;
const DEFAULTS = { buyer: true, pace: 'normal', price: 65, coaPrices: true, perSeller: 20, instant: true, size: 'normal' };

const bool = value => /^(1|true)$/i.test(String(value ?? '').replace(/"/g, '').trim());
const raw = value => String(value ?? '').replace(/"/g, '').trim();
// The choice whose keys all match the file; none of them ('custom') when the player wrote other values by hand.
const matchOf = (table, read) => Object.keys(table).find(id => Object.entries(table[id]).every(([key, value]) => raw(read(key)) === value)) || 'custom';

// The values shown, from the module's text (its .conf, or the .dist when there is none yet). get(key) can also be
// given instead of a text (a realm's own values over CoA's).
function read(source) {
  const get = typeof source === 'function' ? source : key => confValue(source || '', key);
  const price = Number(raw(get('AuctionHouseBot.Buyer.AcceptablePriceModifier')));
  const perSeller = Number(raw(get('AuctionHouseBot.Buyer.MaxPurchasesPerSellerPerDay')));
  const instant = get(INSTANT);
  return {
    buyer: get('AuctionHouseBot.Buyer.Enabled') === undefined || get('AuctionHouseBot.Buyer.Enabled') === null ? DEFAULTS.buyer : bool(get('AuctionHouseBot.Buyer.Enabled')),
    pace: matchOf(PACES, get),
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : DEFAULTS.price,
    coaPrices: get('AuctionHouseBot.CompleteItemValueOverride.Enabled') == null ? DEFAULTS.coaPrices : bool(get('AuctionHouseBot.CompleteItemValueOverride.Enabled')),
    perSeller: Number.isInteger(perSeller) && perSeller >= 0 ? perSeller : DEFAULTS.perSeller,
    instant: instant == null ? null : bool(instant),
    size: matchOf(SIZES, get),
  };
}

// The keys written for the values chosen. A 'custom' pace or size (hand-written values) is left as it is; the
// instant payout only when this CoA Bots knows the key (instantKnown).
function keys(values, { instantKnown = false } = {}) {
  const out = {};
  if (typeof values.buyer === 'boolean') out['AuctionHouseBot.Buyer.Enabled'] = values.buyer ? 'true' : 'false';
  if (PACES[values.pace]) Object.assign(out, PACES[values.pace]);
  const price = Math.round(Number(values.price));
  if (Number.isFinite(price)) out['AuctionHouseBot.Buyer.AcceptablePriceModifier'] = (Math.min(100, Math.max(50, price)) / 100).toFixed(2);
  if (typeof values.coaPrices === 'boolean') out['AuctionHouseBot.CompleteItemValueOverride.Enabled'] = values.coaPrices ? 'true' : 'false';
  const perSeller = Math.round(Number(values.perSeller));
  if (Number.isFinite(perSeller)) out['AuctionHouseBot.Buyer.MaxPurchasesPerSellerPerDay'] = String(Math.min(50, Math.max(0, perSeller)));
  if (instantKnown && typeof values.instant === 'boolean') out[INSTANT] = values.instant ? 'true' : 'false';
  if (SIZES[values.size]) Object.assign(out, SIZES[values.size]);
  return out;
}

// Every key these settings may write (a realm's own layer keeps only these).
const ALL_KEYS = [...new Set(Object.keys(keys({ ...DEFAULTS }, { instantKnown: true })).concat(...Object.values(PACES).map(Object.keys), ...Object.values(SIZES).map(Object.keys)))];

module.exports = { read, keys, ALL_KEYS, INSTANT, SAFE_PRICE, DEFAULTS, PACES, SIZES };
