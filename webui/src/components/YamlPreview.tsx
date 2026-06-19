export function YamlPreview({ yaml }: { yaml: string }) {
  return <pre className="pl-yaml-preview">{yaml}</pre>;
}
