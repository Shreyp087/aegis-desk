export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const { initializeRespan } = await import("./src/lib/observability/respan/bootstrap");
  await initializeRespan();
}
