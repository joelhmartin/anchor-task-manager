// Try primary(); on failure, try fallback() if provided. If both fail, throw a
// combined error that retains both underlying errors for logging.
export async function runWithFallback({ primaryName, primary, fallbackName, fallback }) {
  try {
    return await primary();
  } catch (primaryError) {
    if (!fallback) throw primaryError;
    try {
      return await fallback();
    } catch (fallbackError) {
      const err = new Error(
        `AI providers failed: ${primaryName} (${primaryError.message}); ${fallbackName} (${fallbackError.message})`
      );
      err.primaryError = primaryError;
      err.fallbackError = fallbackError;
      throw err;
    }
  }
}
