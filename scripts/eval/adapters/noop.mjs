export const noopAdapter = {
  id: 'noop',
  label: 'No-op',
  outputFormat: 'plain',
  async preflight() {
    return { ok: true };
  },
  async invoke() {
    return { code: 0, out: '', err: '', skipped: true };
  },
};
