import * as React from 'react';

export function Field(props: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={`tf-field ${props.className ?? ''}`}>
      {props.label !== undefined && (
        <label className="tf-label" htmlFor={props.htmlFor}>{props.label}</label>
      )}
      <div className="tf-field-body">{props.children}</div>
      {props.hint && <p className="tf-hint">{props.hint}</p>}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
  display?: (value: number) => string;
}): React.ReactElement {
  const id = React.useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <div className="tf-slider-row">
        <input
          id={id}
          className="tf-range"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(Number(event.target.value))}
          style={{ '--fill': `${Math.max(0, Math.min(100, ((props.value - props.min) / (props.max - props.min || 1)) * 100))}%` } as React.CSSProperties}
        />
        <span className="tf-value">
          {props.display ? props.display(props.value) : `${Number(props.value.toFixed(2))}${props.unit ?? ''}`}
        </span>
      </div>
    </Field>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: React.ReactNode;
}): React.ReactElement {
  return (
    <label className="tf-toggle">
      <span className="tf-toggle-label">
        <span>{props.label}</span>
        {props.hint && <small>{props.hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="tf-switch" aria-hidden="true"><span /></span>
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
}

export function Segmented<T extends string>(props: {
  label?: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  hint?: React.ReactNode;
}): React.ReactElement {
  return (
    <Field label={props.label} hint={props.hint}>
      <div className="tf-segmented" role="group">
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            className={option.value === props.value ? 'is-active' : ''}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function Select<T extends string | number>(props: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  const id = React.useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <select
        id={id}
        className="tf-select"
        value={String(props.value)}
        disabled={props.disabled}
        onChange={(event) => {
          const raw = event.target.value;
          const found = props.options.find((option) => String(option.value) === raw);
          if (found) props.onChange(found.value);
        }}
      >
        {props.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function ColorField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: React.ReactNode;
}): React.ReactElement {
  const id = React.useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <div className="tf-color-row">
        <input
          id={id}
          className="tf-color"
          type="color"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
        <input
          className="tf-input tf-hex"
          type="text"
          value={props.value}
          spellCheck={false}
          onChange={(event) => {
            const value = event.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(value) || /^#[0-9a-fA-F]{3}$/.test(value)) props.onChange(value);
          }}
        />
      </div>
    </Field>
  );
}

export function TextInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: React.ReactNode;
}): React.ReactElement {
  const id = React.useId();
  return (
    <Field label={props.label} hint={props.hint} htmlFor={id}>
      <input
        id={id}
        className="tf-input"
        type="text"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberInput(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}): React.ReactElement {
  const id = React.useId();
  return (
    <Field label={props.label} htmlFor={id}>
      <div className="tf-number-row">
        <input
          id={id}
          className="tf-input"
          type="number"
          value={Number.isFinite(props.value) ? props.value : ''}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        {props.suffix && <span className="tf-suffix">{props.suffix}</span>}
      </div>
    </Field>
  );
}

export function IconButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      className={`tf-icon-btn ${props.className ?? ''}`}
      aria-label={props.label}
      title={props.title ?? props.label}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

export function Icon(props: { path: React.ReactNode; size?: number }): React.ReactElement {
  return (
    <svg
      width={props.size ?? 18}
      height={props.size ?? 18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {props.path}
    </svg>
  );
}

export const Icons = {
  play: <Icon path={<path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />} />,
  pause: <Icon path={<><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /></>} />,
  restart: <Icon path={<><path d="M4 5v5h5" /><path d="M5.5 9A7 7 0 1 1 5 15" /></>} />,
  upload: <Icon path={<><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>} />,
  download: <Icon path={<><path d="M12 4v12m0 0 5-5m-5 5-5-5" /><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" /></>} />,
  music: <Icon path={<><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>} />,
  sliders: <Icon path={<><path d="M4 7h7M15 7h5M4 17h4M12 17h8" /><circle cx="13" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>} />,
  spark: <Icon path={<><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M18.5 16.5v4M16.5 18.5h4" /></>} />,
  video: <Icon path={<><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 5-3v10l-5-3" /></>} />,
  layout: <Icon path={<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 4v16M8 10h12" /></>} />,
  palette: <Icon path={<><path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z" /><circle cx="7.5" cy="10" r="1" fill="currentColor" /><circle cx="10.5" cy="6.8" r="1" fill="currentColor" /><circle cx="15" cy="7.2" r="1" fill="currentColor" /></>} />,
  uploadCloud: <Icon size={30} path={<><path d="M6.5 18a4.5 4.5 0 0 1-.2-9A6 6 0 0 1 18 10.5a3.8 3.8 0 0 1-.5 7.5" /><path d="M12 21V11m0 0-3.5 3.5M12 11l3.5 3.5" /></>} />,
  close: <Icon path={<><path d="m6 6 12 12M18 6 6 18" /></>} />,
  reset: <Icon path={<><path d="M4 4v6h6" /><path d="M5.5 10A7 7 0 1 1 5 15" /></>} />,
  eye: <Icon path={<><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.6" /></>} />,
};
