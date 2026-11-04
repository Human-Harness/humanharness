import type { InputHTMLAttributes } from "react";
import { Icon } from "./icons";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** The only use of a checkbox (style guide §5): accept something before going on. Anything else is a Toggle. */
  purpose: "accept";
}

/** A checkbox, 18, in the field style. Only to accept something before going on (terms, a copy notice). */
export function Checkbox({ purpose, className, ...rest }: CheckboxProps) {
  return (
    <span className="hh-checkbox-box">
      <input {...rest} type="checkbox" data-purpose={purpose} className={className ? `hh-checkbox ${className}` : "hh-checkbox"} />
      <Icon name="check" size={14} />
    </span>
  );
}

/** A task-list box in rendered Markdown (style guide §6 Markdown: static checkboxes): it shows a state, nothing acts on it. */
export function StaticCheckbox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span role="checkbox" aria-checked={checked} aria-disabled="true" aria-readonly="true" aria-label={label} className="hh-checkbox">
      {checked && <Icon name="check" size={14} />}
    </span>
  );
}
