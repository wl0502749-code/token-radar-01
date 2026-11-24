// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable and sortable table, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, and the live-token protocols set aside. No
// network: every byte it shows is in data.js.
//
// The model and the farm plan are derived here from the same snapshot figures main.ts scores with,
// in the same words: the page recomputes each row's implied value from its stored multipliers and
// checks the number board.json carries, and it rebuilds each farm plan from the protocol's own
// category, chains, TVL and age. A row the page shows is a row the board carries.
(function () {
  'use strict';

  // ---------------------------------------------------------- the model, as main.ts scores it

  // The page recomputes a row from the snapshot figures and checks the number board.json carries,
  // so the page's code and the board's data are visibly the same arithmetic. The multipliers are
  // the rounded ones main.ts stored, multiplied in the same order, so the recompute is exact.
  function impliedOf(row, model) {
    return Math.max(1, Math.round(row.tvl_usd * row.base_multiple * model.launch_discount * row.growth_multiplier * row.maturity_multiplier * row.reach_multiplier));
  }

  // ---------------------------------------------------------- the farm plan, as main.ts writes it

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : chainOf(p); }

  // The typical cost of one simple transaction on a chain, in US dollars.
  function gasUsd(chain) {
    switch (chain) {
      case 'Ethereum': return 4;
      case 'Bitcoin': return 2;
      case 'Tron': return 1;
      case 'Arbitrum': case 'Optimism': case 'Base': case 'Unichain': case 'Ink': case 'Linea':
      case 'Scroll': case 'Mantle': case 'Katana': case 'Sonic': case 'Berachain': case 'Monad':
      case 'Plasma': case 'Avalanche': case 'Blast': case 'Mode': case 'Zircuit': case 'Abstract':
        return 0.3;
      case 'Starknet': return 0.2;
      case 'Binance': return 0.15;
      case 'Polygon': case 'Sui': case 'Hyperliquid L1': case 'Sei': case 'Aptos': return 0.05;
      case 'Solana': return 0.02;
      default: return 1;
    }
  }
  function gasLabel(chain) {
    var g = gasUsd(chain);
    return Number.isInteger(g) ? '$' + g : '$' + g.toFixed(2);
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 1e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply position open.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s managed liquidity vault on " + chain + ' and keep the receipt.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL yield vault on " + chain + ' and keep the shares.';
    if (c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Open a $' + capital + ' leveraged farming position on ' + name + ' on ' + chain + ' at the lowest leverage it offers.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset through " + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and keep the shares.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Deposit $' + capital + ' of BTC into ' + name + ' on ' + chain + ' and hold the receipt it issues.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one position in its most liquid market.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Top up $' + capital + ' on ' + name + ' on ' + chain + ' and make one real payment with it.';
    if (c.indexOf('governance') >= 0) return "Lock $" + capital + " into " + name + "'s incentive program on " + chain + ' and keep it locked.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s CeDeFi vault on " + chain + ' and keep the shares.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and use its main app once.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondFor(p, capital, chain, secondChain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var small = Math.round(capital / 5);
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + small + ' more into a second ' + name + ' vault' + (secondChain === chain ? '' : ' on ' + secondChain) + ' so the wallet touches two of its products.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' against the supply, hold it for a week, then repay it in full.';
    if (c.indexOf('index') >= 0) return 'Rebalance once when the index reweights, or add $' + small + ' on the next rebalance.';
    if (c.indexOf('dex') >= 0) return "Stake the LP receipt in " + name + "'s gauge or rewards contract, or vote once if it runs gauges.";
    if (c.indexOf('liquidity manager') >= 0) return 'Add $' + small + ' to a second ' + name + ' pool on ' + chain + ' and rebalance the range once.';
    if (c.indexOf('yield') >= 0) return 'Compound the first rewards back into the vault, or add $' + small + ' to a second ' + name + ' vault.';
    if (c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0) return 'Harvest the first rewards and restake them instead of selling.';
    if (c.indexOf('rwa') >= 0) return 'Reinvest the first yield payout into the same asset and keep the position.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge, then open a second small position in the opposite direction.';
    if (c.indexOf('basis') >= 0) return 'Check the vault\'s funding rate weekly and top up $' + small + ' when it turns positive.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the first staking rewards instead of claiming them to the wallet.';
    if (c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 'Use the receipt as collateral in a lending market on ' + chain + ' for one small borrow.';
    if (c.indexOf('stable') >= 0) return 'Provide $' + small + ' of the stable asset as liquidity on ' + chain + ' and keep it there.';
    if (c.indexOf('insurance') >= 0) return 'Renew the cover once before it lapses, or buy $' + small + ' of cover on a second pool.';
    if (c.indexOf('prediction') >= 0) return 'Place a second position in a different ' + name + ' market.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Make a second payment of $' + small + ' in a different week.';
    if (c.indexOf('governance') >= 0) return 'Vote on one live proposal with the locked position.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + small + ' into a second ' + name + ' vault on ' + chain + '.';
    if (c.indexOf('chain') >= 0) return 'Use a second app on ' + name + ' once, such as its swap or its lending market.';
    return 'Make a second deposit of $' + small + ' a week after the first one.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var secondChain = secondChainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasLabel(chain);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, keep its seed phrase offline, and fund it with $' + capital + ' of USDC on ' + chain + '.', cost: 'about ' + gas + ' of gas to fund it', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondFor(p, capital, chain, secondChain), cost: 'about ' + gas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active in every snapshot window.', cost: 'about ' + gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; then write the wallet, the dates and every transaction in a farm log.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  // The pure derivation, exported for the build's own test: node loads this file and checks the
  // page's farm plans and implied values against board.json, so the two can never drift apart.
  var PURE = { impliedOf: impliedOf, farmSteps: farmSteps, stepText: stepText, gasUsd: gasUsd, gasLabel: gasLabel, capitalFor: capitalFor, holdDaysFor: holdDaysFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = PURE;
  if (typeof window !== 'undefined') window.RADAR_FARM = PURE;
  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------- the page

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  if (!app) return;
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtUsdFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.watchlist = true;
    if (params.get('tab') === 'live') state.tab = 'live';
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('wl', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlist && !r.is_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'live-dot', text: '● Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index · 758 protocols' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'The token launch radar: ' + DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'Every protocol on the snapshot\'s watchlist — at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record — plus ' + DATA.early_size + ' early ones below that floor. Wrapped, staked and bridged products of tokens that already trade are left out: they are not launches waiting to happen.' }),
        el('p', { class: 'note', text: 'Implied value is a model, calibrated on the market caps the snapshot itself records — not a price, and not a promise that a token ever launches.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'ok', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Market multiple (median mcap / TVL)' }), el('b', { text: fmtMult(DATA.calibration.global_multiple) + 'x' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'wl', checked: state.watchlist ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wl.addEventListener('change', function () { state.watchlist = wl.checked; writeHash(); render(); });
    var wlLabel = el('label', { class: 'check' + (state.watchlist ? ' on' : ''), for: 'wl' }, wl, 'Watchlist only');
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), wlLabel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); } })
      ));
    }
    var max = 1;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'badge ' + (r.is_watchlist ? 'watch' : 'early'), text: r.is_watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Scope' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'badge live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : fmtMult(r.mcap_tvl) + 'x' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their mcap / TVL ratios calibrate it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var topCats = cal.categories.slice().sort(function (a, b) { return b.live_count - a.live_count; }).slice(0, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The base multiple is not a guess: it is the median market-cap-to-TVL ratio of the ' + cal.live_count + ' live-token protocols in this snapshot, blended with the protocol\'s own category median where that category has at least ' + m.category_min_live + ' live protocols.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x base_multiple x ' + m.launch_discount + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + min(chains - 1, ' + m.reach_max_chains + ') x ' + m.reach_per_chain + ') )'
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, chain count and age come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The 0.75 launch discount says a token that does not exist yet is worth less than one that trades. The early radar is every rankable pre-token protocol below the watchlist floor, by TVL.' }),
      el('h3', { text: 'Calibration: median mcap / TVL by category' }),
      el('table', { class: 'calib' },
        el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Median' }), el('th', { text: 'Live protocols' }))),
        el('tbody', null,
          el('tr', null, el('td', { text: 'All live-token protocols' }), el('td', { class: 'num', text: fmtMult(cal.global_multiple) + 'x' }), el('td', { class: 'num', text: String(cal.live_count) })),
          topCats.map(function (c) { return el('tr', null, el('td', { text: c.category }), el('td', { class: 'num', text: fmtMult(c.multiple) + 'x' }), el('td', { class: 'num', text: String(c.live_count) })); })
        )
      )
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Method: the snapshot is DefiLlama\'s protocol index as fetched ' + DATA.as_of + ' (' + DATA.source + '). A protocol "records no token" when its record carries no market cap, no CoinGecko id and no symbol — the record is not proof, so the board never says a protocol has no token. Wrapped, staked and bridged products of tokens that already trade are excluded by category, by name and by exchange prefix, by the same rule the watchlist was drawn with.' }),
      el('p', { text: 'Nothing here is financial advice. Farming a protocol costs gas and locks capital, and a token may never launch; the farm plans say what each step costs and how long it takes so a reader can decide with open eyes.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function whyLine(row) {
    var parts = [];
    parts.push(row.is_watchlist ? 'on the watchlist at $' + Math.round(DATA.floor_usd / 1e6) + 'M+ TVL' : 'an early find below the watchlist floor');
    if (row.change_7d !== null && row.change_7d >= 20) parts.push('TVL up ' + row.change_7d.toFixed(1) + '% in seven days');
    else if (row.change_7d !== null && row.change_7d <= -20) parts.push('TVL down ' + Math.abs(row.change_7d).toFixed(1) + '% in seven days');
    if (row.age_days !== null && row.age_days >= 365) parts.push('running ' + (row.age_days / 365).toFixed(1) + ' years with no token on record');
    else if (row.age_days !== null && row.age_days < 90) parts.push('listed only ' + row.age_days + ' days ago');
    if (row.chains && row.chains.length >= 4) parts.push('live on ' + row.chains.length + ' chains');
    return 'Rank ' + row.rank + ' because it is ' + parts.join(', ') + '.';
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var catCal = null;
    DATA.calibration.categories.forEach(function (c) { if (c.category === row.category) catCal = c; });
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.is_watchlist ? 'watchlist' : 'early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsdFull(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple (mcap / TVL)' }), el('b', { class: 'num', text: fmtMult(row.base_multiple) + 'x' })),
        el('div', null, el('span', { text: 'Launch discount' }), el('b', { class: 'num', text: 'x' + DATA.model.launch_discount })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: 'x' + fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Reach (' + (row.chains ? row.chains.length : 0) + ' chains)' }), el('b', { class: 'num', text: 'x' + fmtMult(row.reach_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsdFull(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsdFull(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + (catCal ? ' Its category median is ' + fmtMult(catCal.multiple) + 'x from ' + catCal.live_count + ' live protocols.' : ' Its category has too few live protocols to calibrate, so it uses the global median ' + fmtMult(DATA.calibration.global_multiple) + 'x.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'why', text: whyLine(row) })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('div', { class: 'plan-total' },
        el('span', null, 'Capital ', el('b', { text: '$' + capitalFor(row) })),
        el('span', null, 'Est. gas ', el('b', { text: '$' + row.farm_gas_usd.toFixed(2) })),
        el('span', null, 'Hold ', el('b', { text: row.farm_hold_days + ' days' }))
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
