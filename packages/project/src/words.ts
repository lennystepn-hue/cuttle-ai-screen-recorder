// What Cuttle knows about spoken words, shared by the speech edits (@cuttle/core) and the editor's
// Transcript tab: how words compare, and which are fillers.

/** Letters and digits only, lower case: how words are compared. */
export const normWord = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');

/** Fillers in German, in English, and those safe whatever the language ("um" and "er" are German words). */
const FILLERS: Record<'de' | 'en' | 'auto', ReadonlySet<string>> = {
  de: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'ähh', 'ähmm']),
  en: new Set(['uh', 'uhm', 'um', 'umm', 'er', 'erm', 'hm', 'hmm', 'mhm', 'ehm']),
  auto: new Set(['äh', 'ähm', 'öh', 'öhm', 'ehm', 'hm', 'hmm', 'mhm', 'uh', 'uhm', 'erm']),
};

/** How whisper writes fillers it misheard (the spike: "Äh" as "E.", "Ähm" as "M."); fillers only alone between pauses. */
export const SHORT_SPELLINGS: ReadonlySet<string> = new Set(['e', 'eh', 'ee', 'm', 'mm', 'hm', 'ä', 'äh', 'ah', 'uh']);

/** The filler words of a language (`de`, `en`, else those safe in both). */
export const fillerLexicon = (language: string): ReadonlySet<string> => FILLERS[language === 'de' || language === 'en' ? language : 'auto'];

/** Whether a word is likely a filler: in the language's lexicon, or one of whisper's short spellings of one. */
export const likelyFiller = (text: string, language: string): boolean => {
  const word = normWord(text);
  return fillerLexicon(language).has(word) || SHORT_SPELLINGS.has(word);
};
