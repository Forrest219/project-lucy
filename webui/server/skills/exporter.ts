import type { SkillAsset, SkillClientTarget, SkillExportBundle } from "./types.js";

export function exportSkillsForClaudeCode(skills: SkillAsset[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const skill of skills) {
    const fileName = `${skill.name}/SKILL.md`;
    files[fileName] = skill.raw;
  }
  return files;
}

export function exportSkillsForCursor(skills: SkillAsset[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const skill of skills) {
    const fileName = `${skill.name}/SKILL.md`;
    files[fileName] = skill.raw;
  }
  return files;
}

export function exportSkillsForMcpJson(
  skills: SkillAsset[],
  proxyUrl = "http://127.0.0.1:7879/mcp"
): Record<string, unknown> {
  return {
    mcpServers: {
      lucy: {
        url: proxyUrl,
        type: "sse",
      },
    },
    governedSkills: skills.map(s => ({
      name: s.name,
      domain: s.domain,
      uri: s.uri,
      title: s.title,
      version: s.version,
    })),
  };
}

export function exportSkillPackage(
  skills: SkillAsset[],
  target: SkillClientTarget,
  options?: { proxyUrl?: string }
): SkillExportBundle {
  const proxyUrl = options?.proxyUrl ?? "http://127.0.0.1:7879/mcp";
  let files: Record<string, string> = {};
  let mcpConfig: Record<string, unknown> | undefined;

  switch (target) {
    case "claude-code":
      files = exportSkillsForClaudeCode(skills);
      break;
    case "cursor":
      files = exportSkillsForCursor(skills);
      break;
    case "mcp-json":
      mcpConfig = exportSkillsForMcpJson(skills, proxyUrl);
      files[".mcp.json"] = JSON.stringify(mcpConfig, null, 2);
      break;
    case "all":
    default:
      const claudeFiles = exportSkillsForClaudeCode(skills);
      for (const [k, v] of Object.entries(claudeFiles)) {
        files[`claude-code/${k}`] = v;
      }
      const cursorFiles = exportSkillsForCursor(skills);
      for (const [k, v] of Object.entries(cursorFiles)) {
        files[`cursor/${k}`] = v;
      }
      mcpConfig = exportSkillsForMcpJson(skills, proxyUrl);
      files[".mcp.json"] = JSON.stringify(mcpConfig, null, 2);
      break;
  }

  return {
    target,
    files,
    mcpConfig,
    exportedAt: new Date().toISOString(),
    count: skills.length,
  };
}
