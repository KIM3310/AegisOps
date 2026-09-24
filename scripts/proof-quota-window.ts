// The callback must recreate its quota fixture on every attempt. Only a real
// clock-window transition permits a retry; response failures are not retried.
export async function inSameQuotaMinute<T>(attempt: () => Promise<T>, now = Date.now): Promise<T> {
  for (let index = 0; index < 3; index++) {
    const minute = Math.floor(now() / 60000);
    const result = await attempt();
    if (Math.floor(now() / 60000) === minute) return result;
  }
  throw new Error('Quota proof could not finish within one minute after three attempts');
}
