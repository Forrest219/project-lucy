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
    <section className="read-panel">
      <h2>页面元信息</h2>
      <label>
        摘要
        <textarea
          rows={3}
          value={value.summary ?? ""}
          onChange={(event) => onChange({ ...value, summary: event.target.value })}
        />
      </label>
      <label>
        标签
        <input
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
      </label>
      <label>
        关联语义对象
        <textarea
          rows={3}
          value={(value.sl_refs ?? []).join("\n")}
          onChange={(event) => onChange({ ...value, sl_refs: splitLines(event.target.value) })}
        />
      </label>
      <label>
        外部引用
        <textarea
          rows={3}
          value={(value.refs ?? []).join("\n")}
          onChange={(event) => onChange({ ...value, refs: splitLines(event.target.value) })}
        />
      </label>
      <label>
        使用方式
        <input
          value={value.usage_mode ?? ""}
          onChange={(event) => onChange({ ...value, usage_mode: event.target.value })}
        />
      </label>
    </section>
  );
}
