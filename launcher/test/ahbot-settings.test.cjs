'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ah = require('../src/ahbot-settings.cjs');

const DIST = [
  'AuctionHouseBot.Enable = true',
  'AuctionHouseBot.Buyer.Enabled = true',
  'AuctionHouseBot.MinutesBetweenBuyCycle = 1:3',
  'AuctionHouseBot.Buyer.BuyCandidatesPerBuyCycle = 3',
  'AuctionHouseBot.Buyer.AcceptablePriceModifier = 0.65',
  'AuctionHouseBot.CompleteItemValueOverride.Enabled = true',
  'AuctionHouseBot.CompleteItemValueOverride.Items = "2589:120,2592:300"',
  'AuctionHouseBot.Buyer.MaxPurchasesPerSellerPerDay = 20',
  'AuctionHouseBot.Alliance.MaxItems = 1400',
  'AuctionHouseBot.Horde.MaxItems = 1400',
  'AuctionHouseBot.Neutral.MaxItems = 200',
].join('\n');

test('the .dist of CoA Bots reads as the defaults, without the instant payout before 2.8', () => {
  assert.deepEqual(ah.read(DIST), { ...ah.DEFAULTS, instant: null });
  assert.equal(ah.read(`${DIST}\nAuctionHouseBot.Buyer.InstantBids = false`).instant, false);
});

test('each choice writes its keys, and only them', () => {
  const out = ah.keys({ buyer: false, pace: 'fast', price: 72, coaPrices: false, perSeller: 0, instant: true, size: 'large' }, { instantKnown: true });
  assert.deepEqual(out, {
    'AuctionHouseBot.Buyer.Enabled': 'false',
    'AuctionHouseBot.MinutesBetweenBuyCycle': '1', 'AuctionHouseBot.Buyer.BuyCandidatesPerBuyCycle': '5',
    'AuctionHouseBot.Buyer.AcceptablePriceModifier': '0.72',
    'AuctionHouseBot.CompleteItemValueOverride.Enabled': 'false',
    'AuctionHouseBot.Buyer.MaxPurchasesPerSellerPerDay': '0',
    'AuctionHouseBot.Buyer.InstantBids': 'true',
    'AuctionHouseBot.Alliance.MaxItems': '2800', 'AuctionHouseBot.Horde.MaxItems': '2800', 'AuctionHouseBot.Neutral.MaxItems': '400',
  });
  assert.ok(!Object.keys(out).some(key => key.includes('CompleteItemValueOverride.Items')));
  assert.ok(ah.ALL_KEYS.includes('AuctionHouseBot.Buyer.InstantBids'));
});

test('bounds, an unknown instant key, and hand-written values left alone', () => {
  const out = ah.keys({ price: 140, perSeller: 99, instant: true, pace: 'custom', size: 'custom' });
  assert.equal(out['AuctionHouseBot.Buyer.AcceptablePriceModifier'], '1.00');
  assert.equal(out['AuctionHouseBot.Buyer.MaxPurchasesPerSellerPerDay'], '50');
  assert.equal(out['AuctionHouseBot.Buyer.InstantBids'], undefined);
  assert.equal(out['AuctionHouseBot.MinutesBetweenBuyCycle'], undefined);
  assert.equal(ah.read(DIST.replace('= 1:3', '= 2:4')).pace, 'custom');
});

test('a realm reads its own values over the CoA ones', () => {
  const own = { 'AuctionHouseBot.Buyer.AcceptablePriceModifier': '0.55' };
  const get = key => own[key] ?? DIST.match(new RegExp(`^${key.replace(/\./g, '\\.')} = (.*)$`, 'm'))?.[1];
  assert.equal(ah.read(get).price, 55);
  assert.equal(ah.read(get).size, 'normal');
});
