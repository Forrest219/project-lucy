import type { Segment } from "../lib/types";

type Props = {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
};

export function SegmentForm({ segments, onChange }: Props) {
  return (
    <section className="read-panel">
      <div className="review-actions">
        <h2>分群</h2>
        <button type="button" onClick={() => onChange([...segments, { name: "", expr: "" }])}>新增</button>
      </div>
      <div className="field-editor-list">
        {segments.map((segment, index) => (
          <div className="inline-grid" key={index}>
            <label>
              名称
              <input value={segment.name} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            </label>
            <label>
              表达式
              <input value={segment.expr} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, expr: event.target.value } : item))} />
            </label>
            <label>
              描述
              <input value={segment.description ?? ""} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
