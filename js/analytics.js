// ─────────────────────────────────────────────────────────
// ANALYTICS — baseline product health instrumentation
// ─────────────────────────────────────────────────────────
export function track(event, props) {
  const payload = { event, ts: Date.now(), ...props };
  // eslint-disable-next-line no-console
  console.info('[track]', payload);
  // To connect a real analytics backend, replace or extend below:
  // window.analytics?.track(event, props);
}
