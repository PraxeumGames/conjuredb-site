// AUTO-GENERATED from docs/benchmarks/comparisons/{latest-benchmarkdotnet-vssqlite-proof,vssqlite-workload-taxonomy}.json
// Regenerate from source; do not hand-edit.

export type BenchRow = {q: string; label: string; sqlite: string; cdb: string; x: string; alloc: string; cls: string; meets: boolean};
export type BenchGroup = {id: string; title: string; tab: string; range: string; rows: BenchRow[]};

export const BENCH_SUMMARY = {"caseCount": 57, "releaseCommon": 56, "releaseCommonGte": 56, "releaseCommonLt": 0, "weakest": 54.81, "families": 12, "target": 50};

export const BENCH_GROUPS: BenchGroup[] = [
  {
    "id": "filter_scan_projection",
    "title": "Filter scan and streaming projection",
    "tab": "Filters",
    "range": "120\u00d7\u20138,807\u00d7",
    "rows": [
      {
        "q": "Q1_FilterLevel",
        "label": "Filter Level",
        "sqlite": "4.36 ms",
        "cdb": "496 ns",
        "x": "8,807\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q1_FilterLevel_Consume",
        "label": "Filter Level (consume)",
        "sqlite": "3.10 ms",
        "cdb": "26.0 \u00b5s",
        "x": "120\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "primary_and_foreign_key_lookup",
    "title": "Primary-key and foreign-key lookup",
    "tab": "Lookups",
    "range": "108\u00d7\u2013440\u00d7",
    "rows": [
      {
        "q": "Q3_PKLookup",
        "label": "PK Lookup",
        "sqlite": "671 ns",
        "cdb": "6.2 ns",
        "x": "108\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q6_FKLookup",
        "label": "FK Lookup",
        "sqlite": "1.71 \u00b5s",
        "cdb": "7.1 ns",
        "x": "242\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q10_PlayerOrdersMinAmount",
        "label": "Player Orders Min Amount",
        "sqlite": "1.71 \u00b5s",
        "cdb": "5.0 ns",
        "x": "341\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q11_TopOrdersForPlayer",
        "label": "Top Orders For Player",
        "sqlite": "2.35 \u00b5s",
        "cdb": "5.3 ns",
        "x": "440\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "ordered_topn",
    "title": "Ordered top-N and index-aligned ranking",
    "tab": "Top-N",
    "range": "67\u00d7\u2013554,330\u00d7",
    "rows": [
      {
        "q": "Q2_TopNScore",
        "label": "Top N Score",
        "sqlite": "3.81 \u00b5s",
        "cdb": "5.8 ns",
        "x": "661\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q9_Top5ByRank",
        "label": "Top5 By Rank",
        "sqlite": "13.2 ms",
        "cdb": "24 ns",
        "x": "554,330\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q14_TopOrderItemScores",
        "label": "Top Order Item Scores",
        "sqlite": "3.85 ms",
        "cdb": "17.2 \u00b5s",
        "x": "223\u00d7",
        "alloc": "264 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q20_TopCompletedWeaponOrderScores",
        "label": "Top Completed Weapon Order Scores",
        "sqlite": "4.32 ms",
        "cdb": "6.23 \u00b5s",
        "x": "693\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q62_GuildCompletedSpendLeaderboard",
        "label": "Guild Completed Spend Leaderboard",
        "sqlite": "5.85 ms",
        "cdb": "87.0 \u00b5s",
        "x": "67\u00d7",
        "alloc": "529 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q68_LevelStatusSpendTopN",
        "label": "Level Status Spend Top N",
        "sqlite": "26.5 ms",
        "cdb": "381 \u00b5s",
        "x": "69\u00d7",
        "alloc": "12.9 KB",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "aggregation",
    "title": "Scalar, grouped, distinct, and correlated aggregation",
    "tab": "Aggregation",
    "range": "55\u00d7\u2013351,866\u00d7",
    "rows": [
      {
        "q": "Q5_Aggregate",
        "label": "Aggregate",
        "sqlite": "9.10 ms",
        "cdb": "3.22 \u00b5s",
        "x": "2,829\u00d7",
        "alloc": "11.6 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q13_PlayerOrderStats",
        "label": "Player Order Stats",
        "sqlite": "17.6 ms",
        "cdb": "90 ns",
        "x": "195,291\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q21_OrderStatusDistinctStats",
        "label": "Order Status Distinct Stats",
        "sqlite": "43.5 ms",
        "cdb": "124 ns",
        "x": "351,866\u00d7",
        "alloc": "552 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q30_OrderActivityLevelStatusDistinctStats",
        "label": "Order Activity Level Status Distinct Stats",
        "sqlite": "73.5 ms",
        "cdb": "1.34 ms",
        "x": "55\u00d7",
        "alloc": "35.6 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q35_TopPlayersByCompletedOrderCount",
        "label": "Top Players By Completed Order Count",
        "sqlite": "8.91 ms",
        "cdb": "707 ns",
        "x": "12,611\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q42_TopPlayerStatusAggregates",
        "label": "Top Player Status Aggregates",
        "sqlite": "30.0 ms",
        "cdb": "1.25 \u00b5s",
        "x": "23,945\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q61_WalletRecentRowsWithBalanceStats",
        "label": "Wallet Recent Rows With Balance Stats",
        "sqlite": "2.19 \u00b5s",
        "cdb": "19 ns",
        "x": "117\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "inner_and_star_joins",
    "title": "Inner, residual, star, and scalar-carry joins",
    "tab": "Joins",
    "range": "59\u00d7\u201318,256\u00d7",
    "rows": [
      {
        "q": "Q4_JoinGuild",
        "label": "Join Guild",
        "sqlite": "1.73 ms",
        "cdb": "9.12 \u00b5s",
        "x": "190\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q7_ComplexJoin",
        "label": "Complex Join",
        "sqlite": "11.3 ms",
        "cdb": "619 ns",
        "x": "18,256\u00d7",
        "alloc": "1008 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q19_PlayersAboveWeaponItemScore",
        "label": "Players Above Weapon Item Score",
        "sqlite": "17.8 ms",
        "cdb": "179 \u00b5s",
        "x": "99\u00d7",
        "alloc": "2.7 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q34_TopWeightedCompletedWeaponOrdersByGuildPolicy",
        "label": "Top Weighted Completed Weapon Orders By Guild Policy",
        "sqlite": "5.55 ms",
        "cdb": "94.0 \u00b5s",
        "x": "59\u00d7",
        "alloc": "506 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q48_TopCompletedWeaponOrdersAboveGlobalWeaponAverage",
        "label": "Top Completed Weapon Orders Above Global Weapon Average",
        "sqlite": "7.01 ms",
        "cdb": "9.81 \u00b5s",
        "x": "714\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q56_ClaimableQuestRewards",
        "label": "Claimable Quest Rewards",
        "sqlite": "2.47 \u00b5s",
        "cdb": "12 ns",
        "x": "209\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "semi_anti_exists",
    "title": "Semi-join, anti-join, and nested exists",
    "tab": "Semi / anti / exists",
    "range": "90\u00d7\u2013413\u00d7",
    "rows": [
      {
        "q": "Q8_Exists",
        "label": "Exists",
        "sqlite": "36.2 ms",
        "cdb": "87.7 \u00b5s",
        "x": "413\u00d7",
        "alloc": "48 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q8_Exists_Consume",
        "label": "Exists (consume)",
        "sqlite": "16.0 ms",
        "cdb": "104 \u00b5s",
        "x": "153\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q16_ActiveNoOrders",
        "label": "Active No Orders",
        "sqlite": "137 \u00b5s",
        "cdb": "1.06 \u00b5s",
        "x": "129\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q44_GuildsWithPlayersHavingOrders",
        "label": "Guilds With Players Having Orders",
        "sqlite": "5.29 \u00b5s",
        "cdb": "59 ns",
        "x": "90\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q58_MissionBoardEligibility",
        "label": "Mission Board Eligibility",
        "sqlite": "118 \u00b5s",
        "cdb": "885 ns",
        "x": "133\u00d7",
        "alloc": "1008 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "window_and_top_per_group",
    "title": "Window, rank, and top-per-group",
    "tab": "Window",
    "range": "74\u00d7\u2013292\u00d7",
    "rows": [
      {
        "q": "Q12_Top3PerLevel",
        "label": "Top3 Per Level",
        "sqlite": "28.7 ms",
        "cdb": "130 \u00b5s",
        "x": "221\u00d7",
        "alloc": "2 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q17_MovingAvg",
        "label": "Moving Avg",
        "sqlite": "22.6 ms",
        "cdb": "77.6 \u00b5s",
        "x": "292\u00d7",
        "alloc": "49 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q23_Top3OrdersPerLevelWithRunningAmount",
        "label": "Top3 Orders Per Level With Running Amount",
        "sqlite": "107 ms",
        "cdb": "412 \u00b5s",
        "x": "259\u00d7",
        "alloc": "4 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q51_PlayersWithScoreRankById",
        "label": "Players With Score Rank By Id",
        "sqlite": "29.8 ms",
        "cdb": "400 \u00b5s",
        "x": "74\u00d7",
        "alloc": "830.3 KB",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "materialized_object_projection",
    "title": "Object projection and materialized result shape",
    "tab": "Projection",
    "range": "12,872\u00d7\u201312,872\u00d7",
    "rows": [
      {
        "q": "Q18_ObjectProjectionCollectTake",
        "label": "Object Projection Collect Take",
        "sqlite": "82.8 ms",
        "cdb": "6.43 \u00b5s",
        "x": "12,872\u00d7",
        "alloc": "43.6 KB",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "set_operations",
    "title": "Set operations with bag and composite-key variants",
    "tab": "Set ops",
    "range": "132\u00d7\u2013532\u00d7",
    "rows": [
      {
        "q": "Q15_IntersectTiers",
        "label": "Intersect Tiers",
        "sqlite": "13.2 ms",
        "cdb": "91.7 \u00b5s",
        "x": "144\u00d7",
        "alloc": "81 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q25_UnionAllTiers",
        "label": "Union All Tiers",
        "sqlite": "61.8 ms",
        "cdb": "470 \u00b5s",
        "x": "132\u00d7",
        "alloc": "4 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q26_IntersectAllTiers",
        "label": "Intersect All Tiers",
        "sqlite": "176 ms",
        "cdb": "331 \u00b5s",
        "x": "532\u00d7",
        "alloc": "450.9 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q27_ExceptAllTiers",
        "label": "Except All Tiers",
        "sqlite": "176 ms",
        "cdb": "363 \u00b5s",
        "x": "485\u00d7",
        "alloc": "449.3 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q28_IntersectPlayersByTierBucket",
        "label": "Intersect Players By Tier Bucket",
        "sqlite": "6.17 ms",
        "cdb": "21.3 \u00b5s",
        "x": "290\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q29_ExceptPlayersByTierBucket",
        "label": "Except Players By Tier Bucket",
        "sqlite": "6.20 ms",
        "cdb": "23.3 \u00b5s",
        "x": "267\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q53_ProductCategoryNameIntersectAllByCategory",
        "label": "Product Category Name Intersect All By Category",
        "sqlite": "97.5 ms",
        "cdb": "195 \u00b5s",
        "x": "501\u00d7",
        "alloc": "1.1 KB",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "outer_join_nullability",
    "title": "Outer join, nullability, and aggregate carry-through",
    "tab": "Outer joins",
    "range": "96\u00d7\u2013205\u00d7",
    "rows": [
      {
        "q": "Q24_PlayersByCompletedOrderAggregates",
        "label": "Players By Completed Order Aggregates",
        "sqlite": "17.1 ms",
        "cdb": "83.4 \u00b5s",
        "x": "205\u00d7",
        "alloc": "6.3 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q32_SparseCompletedOrdersLeftJoin",
        "label": "Sparse Completed Orders Left Join",
        "sqlite": "13.6 ms",
        "cdb": "117 \u00b5s",
        "x": "117\u00d7",
        "alloc": "1 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q33_TopPlayersBySparseCompletedOrders",
        "label": "Top Players By Sparse Completed Orders",
        "sqlite": "15.9 ms",
        "cdb": "137 \u00b5s",
        "x": "116\u00d7",
        "alloc": "3.2 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q36_TopPlayersByCompletedWeaponCount",
        "label": "Top Players By Completed Weapon Count",
        "sqlite": "10.8 ms",
        "cdb": "112 \u00b5s",
        "x": "96\u00d7",
        "alloc": "449 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "distinct_projection_and_aliasing",
    "title": "Distinct projection, aliases, and visible output shape",
    "tab": "Distinct",
    "range": "55\u00d7\u2013285,467\u00d7",
    "rows": [
      {
        "q": "Q31_DistinctPlayerOrderBuckets",
        "label": "Distinct Player Order Buckets",
        "sqlite": "40.9 \u00b5s",
        "cdb": "235 ns",
        "x": "174\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q38_TopPlayersByDistinctWeaponCountAndAmount",
        "label": "Top Players By Distinct Weapon Count And Amount",
        "sqlite": "78.7 ms",
        "cdb": "372 \u00b5s",
        "x": "212\u00d7",
        "alloc": "1.0 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q52_JoinedDistinctItemPageResorted",
        "label": "Joined Distinct Item Page Resorted",
        "sqlite": "184 ms",
        "cdb": "645 ns",
        "x": "285,467\u00d7",
        "alloc": "600 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q63_DistinctQuestRewardCurrencies",
        "label": "Distinct Quest Reward Currencies",
        "sqlite": "4.34 \u00b5s",
        "cdb": "79 ns",
        "x": "55\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q65_TopDistinctOrderBucketsForActivePlayers",
        "label": "Top Distinct Order Buckets For Active Players",
        "sqlite": "25.3 ms",
        "cdb": "346 \u00b5s",
        "x": "73\u00d7",
        "alloc": "35.7 KB",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "terminal_sort_pagination",
    "title": "Terminal sort, pagination, and late page resort",
    "tab": "Sort / page",
    "range": "58\u00d7\u2013218,579\u00d7",
    "rows": [
      {
        "q": "Q49_OrdersByAmountBucketTerminalSort",
        "label": "Orders By Amount Bucket Terminal Sort",
        "sqlite": "42.0 ms",
        "cdb": "528 \u00b5s",
        "x": "80\u00d7",
        "alloc": "977.1 KB",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q50_TopOrderAmountSliceResorted",
        "label": "Top Order Amount Slice Resorted",
        "sqlite": "43.2 ms",
        "cdb": "198 ns",
        "x": "218,579\u00d7",
        "alloc": "168 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q55_ProductInventoryCatalogPage",
        "label": "Product Inventory Catalog Page",
        "sqlite": "14.3 \u00b5s",
        "cdb": "151 ns",
        "x": "95\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q57_PlayerWalletRecentDeltas",
        "label": "Player Wallet Recent Deltas",
        "sqlite": "1.82 \u00b5s",
        "cdb": "13 ns",
        "x": "143\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      },
      {
        "q": "Q64_PlayerTopOrdersPageThenItems",
        "label": "Player Top Orders Page Then Items",
        "sqlite": "3.57 \u00b5s",
        "cdb": "61 ns",
        "x": "58\u00d7",
        "alloc": "0 B",
        "cls": "ReleaseCommon",
        "meets": true
      }
    ]
  },
  {
    "id": "stress_rare",
    "title": "Stress-rare (outside the governed release claim)",
    "tab": "Stress-rare",
    "range": "83\u00d7\u201383\u00d7",
    "rows": [
      {
        "q": "Q54_ProductInventoryFilteredPresentationRows",
        "label": "Product Inventory Filtered Presentation Rows",
        "sqlite": "19.8 ms",
        "cdb": "238 \u00b5s",
        "x": "83\u00d7",
        "alloc": "2 B",
        "cls": "StressRare",
        "meets": true
      }
    ]
  }
];
