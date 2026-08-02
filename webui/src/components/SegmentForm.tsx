import type { Segment } from "../lib/types";

type Props = {
  segments: Segment[];
  onChange: (segments: Segment[]) => void;
};

export function SegmentForm({ segments, onChange }: Props) {
  return (
    <section className="pl-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="pl-panel-title">分群</p>
        <button type="button" className="pl-btn pl-btn--secondary" onClick={() => onChange([...segments, { name: "", expr: "" }])}>新增</button>
      </div>
      <div className="pl-field-editor-list">
        {segments.map((segment, index) => (
          <div className="pl-segment-grid" key={index}>
            <label className="pl-field-label">
              <span>名称</span>
              <input className="pl-input" value={segment.name} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            </label>
            <label className="pl-field-label">
              <span>表达式</span>
              <input className="pl-input" value={segment.expr} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, expr: event.target.value } : item))} />
            </label>
            <label className="pl-field-label">
              <span>描述</span>
              <input className="pl-input" value={segment.description ?? ""} onChange={(event) => onChange(segments.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
