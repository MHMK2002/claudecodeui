const flights = new Map<string, Promise<unknown>>();

export function runSingleFlight<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = flights.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const flight = operation().finally(() => {
    if (flights.get(key) === flight) {
      flights.delete(key);
    }
  });
  flights.set(key, flight);
  return flight;
}
