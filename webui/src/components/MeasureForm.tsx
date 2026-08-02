import type { Measure } from "../lib/types";

type Props = {
  measures: Measure[];
  onChange: (measures: Measure[]) => void;
};

export function MeasureForm({ measures, onChange }: Props) {
  return (
    <section className="pl-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="pl-panel-title">指标</p>
        <button type="button" className="pl-btn pl-btn--secondary" onClick={() => onChange([...measures, { name: "", expr: "" }])}>新增</button>
      </div>
      <div className="pl-field-editor-list">
        {measures.map((measure, index) => (
          <div className="pl-measure-grid" key={index}>
            <label className="pl-field-label">
              <span>名称</span>
              <input className="pl-input" value={measure.name} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            </label>
            <label className="pl-field-label">
              <span>表达式</span>
              <input className="pl-input" value={measure.expr} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, expr: event.target.value } : item))} />
            </label>
            <label className="pl-field-label">
              <span>过滤条件</span>
              <input className="pl-input" value={measure.filter ?? ""} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, filter: event.target.value } : item))} />
            </label>
            <label className="pl-field-label">
              <span>描述</span>
              <input className="pl-input" value={measure.description ?? ""} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
