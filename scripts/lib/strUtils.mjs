// Trim a value to a plain string, capped at `max` chars; anything that isn't
// already a string (missing field, model hallucinated an object) becomes "".
export const str = (value, max = 240) => typeof value === "string" ? value.trim().slice(0, max) : "";
