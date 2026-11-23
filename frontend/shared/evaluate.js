// Єдина функція оцінки «ок / не ок» (етапи 2 і 3).
// Бекенд придатність не обчислює і не зберігає.
export function evaluateStage(stage, value, limits) {
  if (stage === 2) {
    if (value == null || limits == null || limits.insulation_min_mohm == null) return null;
    return value >= limits.insulation_min_mohm ? "ok" : "bad";
  }
  if (stage === 3) {
    if (value == null || limits == null || limits.earth_max_ohm == null) return null;
    return value <= limits.earth_max_ohm ? "ok" : "bad";
  }
  return null;
}
