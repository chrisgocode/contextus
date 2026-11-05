# Ticket 298 payload validation

The deterministic fixture in `convex/tests/guesses.test.ts` uses 349 guesses,
two players, fixed timestamps and representative avatar URLs.
Reconstructing the former hydrated response from the same query records,
including Latest, gives 164,276 serialized JSON characters. The shared player
map response, including Latest and both players, gives 81,341 characters:
a 50.5% reduction. Profile metadata and identifiers affect this ratio.

These are local JSON character counts, not compressed subscription transport
bytes, database-read savings, or measured rendering speedups. No production
subscription or React rendering measurements were captured.
