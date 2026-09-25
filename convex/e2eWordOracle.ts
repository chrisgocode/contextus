import type { WordOracle } from "./wordOracle";

const ANSWER = "word0";
const RANKED_WORD = /^word(\d+)$/;
const PLAIN_WORD = /^[a-z]+$/;
// Hints start at rank 299, so other words score beyond every hint rank a
// Playwright run can reach.
const OTHER_WORDS_MIN_DISTANCE = 1000;
const OTHER_WORDS_RANGE = 9000;

// FNV-1a, so the same word scores the same in every game and every run.
function hash(word: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i += 1) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministic word oracle used when E2E_TEST=1, so Playwright runs never
// depend on api.contexto.me. "wordN" scores N and "word0" is every puzzle's
// answer; other plain words score a stable distance of 1000 or more.
export const e2eWordOracle: WordOracle = {
  async distance(_contextoGameId, word) {
    const ranked = RANKED_WORD.exec(word);
    if (ranked !== null) {
      return { ok: true, lemma: word, distance: Number(ranked[1]) };
    }
    if (!PLAIN_WORD.test(word)) {
      return { ok: false, error: "I'm sorry, I don't know this word" };
    }
    return {
      ok: true,
      lemma: word,
      distance: OTHER_WORDS_MIN_DISTANCE + (hash(word) % OTHER_WORDS_RANGE),
    };
  },

  async tip(_contextoGameId, distance) {
    return { lemma: `word${distance}`, distance };
  },

  async answer() {
    return { lemma: ANSWER };
  },
};
