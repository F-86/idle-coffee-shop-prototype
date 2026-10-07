# Synthetic migration fixtures

`economy3-operations-migration.json` contains synthetic states generated from the previously published branch at commit `44d15c97c8bc928e16a4af857bac5b7403e9f7d7` (economy3/layout2/customer route3). It contains no user save data.

The states retain the old live cash model and representative inactive/active/expanded/paused/in-flight phases. New tests validate the original economic and route relationships before checking the one-time direct-credit/two-door migration. Do not replace these with `createInitialState()` from the current engine: that would erase the compatibility boundary under test.

`economy4-ingredients-migration.json` contains synthetic initial, in-flight, and paused states generated from commit `b6fb418a170308ea0a1a8aa1127551ab146407c4` (economy4/layout3/customer route4). It has no inventory fields. Keep it frozen so inventory migration tests remain independent of the current engine.

`entry-counter-assignment-v9.json` is a synthetic v10 checkpoint generated from `f47e38d556c7621ee0e827a9ae83bd0d14b8a943` at34.8 simulated seconds, using the initial two-counter shop and replenished test ingredients. Guest6 waits outside for B while a collision-free route to stocked A is available. It contains no real save or identity. Keep it frozen to reproduce the pre-fix assignment error independently of the current dispatcher.
