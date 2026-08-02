import { useState } from "react";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
};

export function TagInput({ value, onChange, placeholder }: Props) {
  const [draft, setDraft] = useState("");

  function commit() {
    const items = draft
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) {
      return;
    }
    const merged = [...value];
    for (const item of items) {
      if (!merged.includes(item)) {
        merged.push(item);
      }
    }
    onChange(merged);
    setDraft("");
  }

  function remove(tag: string) {
    onChange(value.filter((item) => item !== tag));
  }

  return (
    <div className="pl-tag-input" role="list" aria-label="标签">
      {value.map((tag) => (
        <span className="pl-chip pl-chip--muted" key={tag} role="listitem">
          <span className="pl-chip-label">{tag}</span>
          <button
            aria-label={`移除标签 ${tag}`}
            className="pl-chip-remove"
            onClick={() => remove(tag)}
            type="button"
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label="添加标签"
        className="pl-tag-input-field"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && draft.length === 0 && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder={value.length === 0 ? placeholder ?? "输入标签后回车" : "继续添加…"}
        value={draft}
      />
    </div>
  );
}
