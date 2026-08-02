import * as Label from "@radix-ui/react-label";
import { useState } from "react";
import { SlRefPicker } from "./SlRefPicker";
import { TagInput } from "./TagInput";
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <section className="pl-panel pl-frontmatter">
      <header className="pl-frontmatter-header">
        <p className="pl-panel-title">页面元信息</p>
        <p className="pl-notice">
          关联语义对象与标签会驱动 Wiki ↔ 表编辑器的双向跳转。摘要会出现在文档列表与目录。
        </p>
      </header>
      <div className="pl-frontmatter-grid">
        <Label.Root className="pl-field-label pl-frontmatter-cell">
          <Label.Label>关联语义对象</Label.Label>
          <SlRefPicker
            onChange={(next) => onChange({ ...value, sl_refs: next })}
            value={value.sl_refs ?? []}
          />
        </Label.Root>
        <Label.Root className="pl-field-label pl-frontmatter-cell">
          <Label.Label>标签</Label.Label>
          <TagInput
            onChange={(next) => onChange({ ...value, tags: next })}
            value={value.tags ?? []}
          />
        </Label.Root>
        <Label.Root className="pl-field-label pl-frontmatter-cell pl-frontmatter-cell--wide">
          <Label.Label>摘要</Label.Label>
          <textarea
            className="pl-textarea"
            onChange={(event) => onChange({ ...value, summary: event.target.value })}
            placeholder="一句话说明本页解决了什么业务问题"
            rows={2}
            value={value.summary ?? ""}
          />
        </Label.Root>
      </div>
      <div className="pl-frontmatter-advanced">
        <button
          aria-expanded={showAdvanced}
          className="pl-btn pl-btn--ghost pl-frontmatter-advanced-toggle"
          onClick={() => setShowAdvanced((current) => !current)}
          type="button"
        >
          {showAdvanced ? "收起更多元信息" : "更多元信息"}
        </button>
        {showAdvanced ? (
          <div className="pl-frontmatter-advanced-body">
            <Label.Root className="pl-field-label">
              <Label.Label>外部引用</Label.Label>
              <textarea
                aria-label="外部引用"
                className="pl-textarea"
                onChange={(event) => onChange({ ...value, refs: splitLines(event.target.value) })}
                rows={3}
                value={(value.refs ?? []).join("\n")}
              />
            </Label.Root>
            <Label.Root className="pl-field-label">
              <Label.Label>使用方式</Label.Label>
              <input
                aria-label="使用方式"
                className="pl-input"
                onChange={(event) => onChange({ ...value, usage_mode: event.target.value })}
                value={value.usage_mode ?? ""}
              />
            </Label.Root>
          </div>
        ) : null}
      </div>
    </section>
  );
}
