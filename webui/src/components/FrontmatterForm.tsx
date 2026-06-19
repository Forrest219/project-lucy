import * as Label from "@radix-ui/react-label";
import type { WikiFrontmatter } from "../lib/types";

type Props = {
  value: WikiFrontmatter;
  onChange: (value: WikiFrontmatter) => void;
};

function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function FrontmatterForm({ value, onChange }: Props) {
  return (
    <section className="pl-panel">
      <h2 className="pl-panel-title">页面元信息</h2>
      <Label.Root className="pl-field-label">
        <Label.Label>摘要</Label.Label>
        <textarea
          rows={3}
          className="pl-textarea"
          value={value.summary ?? ""}
          onChange={(event) => onChange({ ...value, summary: event.target.value })}
        />
      </Label.Root>
      <Label.Root className="pl-field-label">
        <Label.Label>标签</Label.Label>
        <input
          className="pl-input"
          value={(value.tags ?? []).join(", ")}
          onChange={(event) =>
            onChange({
              ...value,
              tags: event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            })
          }
        />
      </Label.Root>
      <Label.Root className="pl-field-label">
        <Label.Label>关联语义对象</Label.Label>
        <textarea
          rows={3}
          className="pl-textarea"
          value={(value.sl_refs ?? []).join("\n")}
          onChange={(event) => onChange({ ...value, sl_refs: splitLines(event.target.value) })}
        />
      </Label.Root>
      <Label.Root className="pl-field-label">
        <Label.Label>外部引用</Label.Label>
        <textarea
          rows={3}
          className="pl-textarea"
          value={(value.refs ?? []).join("\n")}
          onChange={(event) => onChange({ ...value, refs: splitLines(event.target.value) })}
        />
      </Label.Root>
      <Label.Root className="pl-field-label">
        <Label.Label>使用方式</Label.Label>
        <input
          className="pl-input"
          value={value.usage_mode ?? ""}
          onChange={(event) => onChange({ ...value, usage_mode: event.target.value })}
        />
      </Label.Root>
    </section>
  );
}