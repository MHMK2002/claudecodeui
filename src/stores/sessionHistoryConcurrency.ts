/** A request is superseded as soon as any later history request has started. */
export function isSupersededSessionHistoryFetch(
  requestTicket: number,
  latestStartedTicket: number,
): boolean {
  return requestTicket !== latestStartedTicket;
}
