import assert from 'node:assert/strict';
import { computeRoleAgentPreviewBinding, resolveCompileInputsDigest } from '/app/webui/server/admin/access-roles-agent-concurrent-edit.ts';
import { computeAgentBaseObjectVersion, computeRoleBaseObjectVersion } from '/app/webui/server/admin/access-object-version.ts';
const user = { id: 'sc09_agent', name: 'SC09', roles: ['reader'], tokens: [] };
const role = { permission_model_version: 2 as const, allow: { tools: ['lucy_query'], connections: ['hive-1'], tableSelectors: [{ connection: 'hive-1', schema: 'weather', names: ['city'], row_access: 'scoped' as const, row_policy: { template: 'region_scope' } }] } };
const config = (value: string, denied: string) => ({ users: [user], roles: { reader: role }, defaults: { deny_tools: [denied] }, row_policy_templates: { region_scope: { predicates: [{ field: 'region', op: 'eq', value }] } } });
const compileInputsDigest = resolveCompileInputsDigest('a'.repeat(64));
const preview = (kind: 'role'|'agent', value: string, denied: string) => computeRoleAgentPreviewBinding({
  kind, objectId: kind === 'role' ? 'reader' : user.id,
  baseObjectVersion: kind === 'role' ? computeRoleBaseObjectVersion('reader', role) : computeAgentBaseObjectVersion(user.id, user),
  config: config(value, denied), patch: { description: 'SC09' }, compileInputsDigest,
  gate: { decision: 'allow', findings: [], tierSummary: {} } as Parameters<typeof computeRoleAgentPreviewBinding>[0]['gate']
});
for (const kind of ['role','agent'] as const) {
  const first = preview(kind, 'east', 'unused_a');
  assert.notEqual(first.previewDependenciesDigest, preview(kind, 'west', 'unused_a').previewDependenciesDigest);
  assert.notEqual(first.previewDependenciesDigest, preview(kind, 'east', 'unused_b').previewDependenciesDigest);
}
console.log(JSON.stringify({ status: 'PASS', process: 'real Docker tsx, no mocks', roleTemplateChange: true, agentExpandedTemplateChange: true, defaultsChange: true }));
