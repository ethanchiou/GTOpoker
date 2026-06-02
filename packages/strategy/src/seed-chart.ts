import type { ChartSet } from './preflop-chart'

/**
 * SEED / PLACEHOLDER preflop chart for 6-max NLHE 100bb.
 *
 * These ranges are hand-authored approximations to get the full pipeline and
 * play loop working — they are NOT vetted GTO solutions. Per spec §6.3/§7.2 the
 * chart set is versioned and swappable: replace this with free published charts
 * (then solver/licensed data) behind the same interface, and `confidence` should
 * rise from 'low' accordingly. Sizes use the `raiseTo:<bb>` convention.
 *
 * Coverage: RFI (UTG/HJ/CO/BTN/SB), a few vs-RFI spots, and opener-facing-3bet
 * spots for the current bot 3-bet paths. Unmodelled nodes (cold 4-bets, deeper
 * trees, other matchups) are reported unsupported and fall back to a simple bot
 * policy. Action ranges within a spot must not overlap above 100%.
 */
export const SEED_CHART: ChartSet = {
  version: 'seed-placeholder-0',
  rakeAssumption: 'none (placeholder)',
  confidence: 'low',
  spots: [
    // ---- RFI (raise-first-in) ----
    {
      id: 'rfi/UTG',
      heroPosition: 'UTG',
      actions: [{ id: 'raiseTo:2.5', range: '66+, ATs+, KTs+, QJs, JTs, T9s, AJo+, KQo' }],
    },
    {
      id: 'rfi/HJ',
      heroPosition: 'HJ',
      actions: [{ id: 'raiseTo:2.5', range: '55+, A9s+, A5s, KTs+, QTs+, J9s+, T9s, 98s, ATo+, KJo+' }],
    },
    {
      id: 'rfi/CO',
      heroPosition: 'CO',
      actions: [
        {
          id: 'raiseTo:2.5',
          range: '44+, A7s+, A5s-A2s, K9s+, Q9s+, J9s+, T8s+, 97s+, 87s, 76s, A9o+, KTo+, QTo+, JTo',
        },
      ],
    },
    {
      id: 'rfi/BTN',
      heroPosition: 'BTN',
      actions: [
        {
          id: 'raiseTo:2.5',
          // A5o is a mixed open (50%) — exercises the mixed-strategy code paths.
          range:
            '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A6o+, A2o-A4o, A5o:0.5, K9o+, Q9o+, J9o+, T9o',
        },
      ],
    },
    {
      id: 'rfi/SB',
      heroPosition: 'SB',
      actions: [
        {
          id: 'raiseTo:3',
          range: '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, A4o+, K9o+, QTo+, JTo',
        },
      ],
    },

    // ---- vs-RFI (facing a single open) ----
    {
      id: 'vsRfi/HJ/vsUTG',
      heroPosition: 'HJ',
      openerPosition: 'UTG',
      actions: [
        { id: 'raiseTo:9.5', range: 'QQ+, AKs, AKo, A5s:0.25' },
        { id: 'call', range: '77-JJ, AQs-AJs, KQs, QJs, JTs, AQo' },
      ],
    },
    {
      id: 'vsRfi/CO/vsUTG',
      heroPosition: 'CO',
      openerPosition: 'UTG',
      actions: [
        { id: 'raiseTo:9.5', range: 'QQ+, AKs, AKo, A5s:0.25' },
        { id: 'call', range: '66-JJ, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AQo' },
      ],
    },
    {
      id: 'vsRfi/CO/vsHJ',
      heroPosition: 'CO',
      openerPosition: 'HJ',
      actions: [
        { id: 'raiseTo:9.5', range: 'JJ+, AKs, AKo, A5s:0.5' },
        { id: 'call', range: '66-TT, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AQo, KQo' },
      ],
    },
    {
      id: 'vsRfi/BTN/vsUTG',
      heroPosition: 'BTN',
      openerPosition: 'UTG',
      actions: [
        { id: 'raiseTo:9.5', range: 'QQ+, AKs, AKo, A5s:0.25' },
        { id: 'call', range: '55-JJ, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo' },
      ],
    },
    {
      id: 'vsRfi/BTN/vsHJ',
      heroPosition: 'BTN',
      openerPosition: 'HJ',
      actions: [
        { id: 'raiseTo:9.5', range: 'JJ+, AKs, AKo, A5s-A4s:0.5' },
        { id: 'call', range: '55-TT, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo, KQo' },
      ],
    },
    {
      id: 'vsRfi/BTN/vsCO',
      heroPosition: 'BTN',
      openerPosition: 'CO',
      actions: [
        { id: 'raiseTo:9.5', range: 'TT+, AJs+, A5s-A4s, KQs, AQo+' },
        {
          id: 'call',
          range: '44-99, A2s-A3s, A6s-ATs, KTs-KJs, QTs+, JTs, T9s, 98s, 87s, AJo, KQo, QJo',
        },
      ],
    },
    {
      id: 'vsRfi/SB/vsUTG',
      heroPosition: 'SB',
      openerPosition: 'UTG',
      actions: [
        { id: 'raiseTo:11', range: 'QQ+, AKs, AKo, A5s:0.25' },
        { id: 'call', range: '99-JJ, AQs-AJs, KQs, AQo' },
      ],
    },
    {
      id: 'vsRfi/SB/vsHJ',
      heroPosition: 'SB',
      openerPosition: 'HJ',
      actions: [
        { id: 'raiseTo:11', range: 'JJ+, AKs, AKo, A5s:0.5' },
        { id: 'call', range: '88-TT, AQs-ATs, KQs, KJs, QJs, AQo' },
      ],
    },
    {
      id: 'vsRfi/SB/vsCO',
      heroPosition: 'SB',
      openerPosition: 'CO',
      actions: [
        { id: 'raiseTo:11', range: 'TT+, AJs+, A5s-A4s, KQs, AQo+' },
        { id: 'call', range: '77-99, ATs, KJs, QJs, JTs, AJo, KQo' },
      ],
    },
    {
      id: 'vsRfi/BB/vsBTN',
      heroPosition: 'BB',
      openerPosition: 'BTN',
      actions: [
        { id: 'raiseTo:11', range: 'TT+, AJs+, A5s-A4s, KQs, AQo+' },
        {
          id: 'call',
          range:
            '22-99, A2s-A3s, A6s-ATs, K2s-KJs, Q5s-QJs, J7s-JTs, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o-AJo, K9o-KQo, QTo+, JTo',
        },
      ],
    },
    {
      id: 'vsRfi/BB/vsCO',
      heroPosition: 'BB',
      openerPosition: 'CO',
      actions: [
        { id: 'raiseTo:11', range: 'JJ+, AQs+, AKo, A5s' },
        {
          id: 'call',
          range: '22-TT, A2s-A4s, A6s-AJs, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, A8o-AJo, KTo+, QJo',
        },
      ],
    },
    {
      id: 'vsRfi/BB/vsHJ',
      heroPosition: 'BB',
      openerPosition: 'HJ',
      actions: [
        { id: 'raiseTo:11', range: 'QQ+, AKs, AKo, A5s:0.5' },
        {
          id: 'call',
          range: '22-JJ, A2s-A4s, A6s-AQs, K9s+, Q9s+, J9s+, T9s, 98s, AJo-AQo, KQo',
        },
      ],
    },
    {
      id: 'vsRfi/BB/vsUTG',
      heroPosition: 'BB',
      openerPosition: 'UTG',
      actions: [
        { id: 'raiseTo:11', range: 'QQ+, AKs, AKo, A5s:0.25' },
        {
          id: 'call',
          range: '22-JJ, A2s-A4s, AQs-AJs, KQs, KJs, QJs, JTs, T9s, AQo',
        },
      ],
    },
    {
      id: 'vsRfi/SB/vsBTN',
      heroPosition: 'SB',
      openerPosition: 'BTN',
      actions: [
        { id: 'raiseTo:12', range: '99+, ATs+, KJs+, A5s, AQo+' },
        { id: 'call', range: '55-88, KTs, QTs+, JTs' },
      ],
    },
    {
      id: 'vsRfi/BB/vsSB',
      heroPosition: 'BB',
      openerPosition: 'SB',
      actions: [
        { id: 'raiseTo:10', range: '99+, ATs+, KQs, AQo+' },
        {
          id: 'call',
          range:
            '22-88, A2s-A9s, K2s-KJs, Q2s-QJs, J2s-JTs, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o-AJo, K2o-KQo, Q4o+, J7o+, T7o+, 98o, 87o, 76o',
        },
      ],
    },

    // ---- vs-3bet (original opener facing a single 3-bet) ----
    {
      id: 'vs3bet/BTN/vsBB',
      heroPosition: 'BTN',
      threeBetPosition: 'BB',
      actions: [
        { id: 'raiseTo:25', range: 'JJ-QQ, KK+:0.75, AKs:0.75, AKo:0.5, A5s-A4s:0.5' },
        { id: 'allIn', range: 'KK+:0.25, AKs:0.25, AKo:0.5' },
        {
          id: 'call',
          range: '77-TT, AQs, AJs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo',
        },
      ],
    },
    {
      id: 'vs3bet/BTN/vsSB',
      heroPosition: 'BTN',
      threeBetPosition: 'SB',
      actions: [
        { id: 'raiseTo:27.5', range: 'JJ-QQ, KK+:0.75, AKs:0.75, AKo:0.5, A5s-A4s:0.5' },
        { id: 'allIn', range: 'KK+:0.25, AKs:0.25, AKo:0.5' },
        {
          id: 'call',
          range: '77-TT, AQs, AJs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo',
        },
      ],
    },
    {
      id: 'vs3bet/CO/vsBB',
      heroPosition: 'CO',
      threeBetPosition: 'BB',
      actions: [
        { id: 'raiseTo:25', range: 'QQ, KK+:0.75, AKs:0.75, AKo:0.5, A5s:0.5' },
        { id: 'allIn', range: 'KK+:0.25, AKs:0.25, AKo:0.5' },
        { id: 'call', range: '88-JJ, AQs, AJs-ATs, KQs, KJs, QJs, JTs, AQo' },
      ],
    },
    {
      id: 'vs3bet/HJ/vsBB',
      heroPosition: 'HJ',
      threeBetPosition: 'BB',
      actions: [
        { id: 'raiseTo:25', range: 'QQ, KK+:0.75, AKs:0.75, AKo:0.5, A5s:0.25' },
        { id: 'allIn', range: 'KK+:0.25, AKs:0.25, AKo:0.5' },
        { id: 'call', range: '99-JJ, AQs, AJs, KQs, AQo' },
      ],
    },
    {
      id: 'vs3bet/UTG/vsBB',
      heroPosition: 'UTG',
      threeBetPosition: 'BB',
      actions: [
        { id: 'raiseTo:25', range: 'QQ, KK+:0.75, AKs:0.75, AKo:0.5' },
        { id: 'allIn', range: 'KK+:0.25, AKs:0.25, AKo:0.5' },
        { id: 'call', range: 'TT-JJ, AQs, AJs, KQs, AQo' },
      ],
    },
  ],
}
