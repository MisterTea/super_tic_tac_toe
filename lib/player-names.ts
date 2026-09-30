import {
  adjectives,
  animals,
  uniqueNamesGenerator,
} from "unique-names-generator";

const words = (dictionary: string[]) =>
  dictionary.filter((word) => /^[a-z]{2,11}$/i.test(word));
const dictionaries = [words(adjectives), words(animals)];
export function generatePlayerName(seed?: number) {
  return uniqueNamesGenerator({
    dictionaries,
    length: 2,
    separator: " ",
    style: "capital",
    seed,
  });
}
export function displayName(input: string) {
  const name = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z0-9 _-]{3,24}$/.test(name))
    throw new Error(
      "Use 3–24 characters: letters, numbers, spaces, hyphens, or underscores.",
    );
  return name;
}
export const nameKey = (name: string) =>
  name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
