/**
 * Unifies `keyFixed` with `keyVars`.
 * If they match, returns an updated state consistent with `partialState`.
 * If they do not match each other, or conflict with the provided `partialState`,
 * returns `null` instead.
 */
export function unifyKeys(
  keyFixed: string,
  keyVars: string,
  partialState: ReadonlyMap<string, string>,
): Map<string, string> | null {
  if (keyVars === "*" && keyFixed === "no") {
    return null;
  }
  if (keyVars === "*") {
    return new Map(partialState);
  }
  const keyFixedParts = keyFixed.split("_");
  const keyVarsParts = keyVars.split("_").map(v => partialState.get(v) ?? v);
  if (keyFixedParts.length !== keyVarsParts.length) {
    return null;
  }
  const newState = new Map(partialState);
  for (let i = 0; i < keyFixedParts.length; i++) {
    const fixed = keyFixedParts[i];
    let variable = keyVarsParts[i];
    if (newState.has(variable)) {
      if (newState.get(variable) !== fixed) {
        return null;
      }
      continue;
    }
    if (variable.startsWith("@")) {
      newState.set(variable, fixed);
      continue;
    }
    if (fixed !== variable) {
      return null;
    }
  }
  return newState;
}
