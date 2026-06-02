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
 * Coverage: RFI (UTG/HJ/CO/BTN/SB) and a few vs-RFI spots. Unmodelled nodes
 * (3-bet pots, other matchups) are reported unsupported and fall back to a
 * simple bot policy. Action ranges within a spot must not overlap above 100%.
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
      id: 'vsRfi/SB/vsBTN',
      heroPosition: 'SB',
      openerPosition: 'BTN',
      actions: [
        { id: 'raiseTo:12', range: '99+, ATs+, KJs+, A5s, AQo+' },
        { id: 'call', range: '55-88, KTs, QTs+, JTs' },
      ],
    },
  ],
}
