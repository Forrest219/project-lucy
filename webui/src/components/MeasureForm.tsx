import type { Measure } from "../lib/types";

type Props = {
  measures: Measure[];
  onChange: (measures: Measure[]) => void;
};

export function MeasureForm({ measures, onChange }: Props) {
  return (
    <section className="read-panel">
      <div className="review-actions">
        <h2>指标</h2>
        <button type="button" onClick={() => onChange([...measures, { name: "", expr: "" }])}>新增</button>
      </div>
      <div className="field-editor-list">
        {measures.map((measure, index) => (
          <div className="inline-grid" key={index}>
            <label>
              名称
              <input value={measure.name} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} />
            </label>
            <label>
              表达式
              <input value={measure.expr} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, expr: event.target.value } : item))} />
            </label>
            <label>
              过滤条件
              <input value={measure.filter ?? ""} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, filter: event.target.value } : item))} />
            </label>
            <label>
              描述
              <input value={measure.description ?? ""} onChange={(event) => onChange(measures.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
