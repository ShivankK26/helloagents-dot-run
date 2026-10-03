import type { AgentId } from "../../../shared/api";
import type { AgentOption } from "../agents";

export function AgentSelect({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: AgentId;
  options: AgentOption[];
  onChange: (value: AgentId) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as AgentId)}>
        {options.map((o) => (
          <option key={o.id} value={o.id} disabled={Boolean(o.unavailable)}>
            {o.name} · {o.unavailable ?? o.billing}
          </option>
        ))}
      </select>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
