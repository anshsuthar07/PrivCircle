"use client";

import {
  ButtonHTMLAttributes,
  ComponentPropsWithRef,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import styles from "./controls.module.css";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size = "standard",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "tool" | "icon";
  size?: "main" | "standard" | "compact";
}) {
  return (
    <button
      className={classes(
        styles.button,
        styles[variant],
        styles[size],
        variant === "primary" && "primary-button",
        variant === "tool" && "tool-button",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function FormField({
  id,
  label,
  optional,
  action,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  optional?: string;
  action?: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={classes(styles.field, "field-group", className)}>
      <div className={styles.labelRow}>
        <label htmlFor={id}>
          {label}
          {optional ? <span className={styles.optional}> {optional}</span> : null}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className={styles.errorText} id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <div className={styles.hint} id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid = false,
  className,
  ...props
}: ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  return (
    <input
      className={classes(styles.input, "standard-input", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function PasswordInput({
  invalid = false,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={classes(styles.passwordShell, className)}>
      <TextInput
        {...props}
        className={styles.passwordInput}
        type={visible ? "text" : "password"}
        invalid={invalid}
      />
      <Button
        className={styles.passwordToggle}
        type="button"
        variant="ghost"
        size="standard"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "Hide" : "Show"}
      </Button>
    </div>
  );
}

export function Select({
  id,
  name,
  value,
  options,
  onValueChange,
  disabled = false,
  placement = "bottom",
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string;
  name?: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placement?: "top" | "bottom";
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const generatedId = useId();
  const controlId = id || `select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function commit(index: number) {
    const option = options[index];
    if (!option) return;
    onValueChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      openAt(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const startingIndex = open ? activeIndex : selectedIndex;
      openAt((startingIndex + direction + options.length) % options.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(activeIndex);
      else openAt(selectedIndex);
    }
  }

  const selected = options[selectedIndex];

  return (
    <div className={classes(styles.selectShell, className)} ref={rootRef}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        className={styles.selectButton}
        ref={buttonRef}
        id={controlId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <path d="m6 8 4 4 4-4" />
        </svg>
      </button>
      {open ? (
        <div
          className={classes(styles.selectListbox, styles[placement])}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => (
            <div
              className={classes(
                styles.selectOption,
                index === activeIndex && styles.highlighted,
              )}
              id={`${listboxId}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(index)}
              onPointerMove={() => setActiveIndex(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <span aria-hidden="true">✓</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function InfoTooltip({
  label,
  children,
  align = "right",
}: {
  label: string;
  children: ReactNode;
  align?: "center" | "right";
}) {
  const tooltipId = `tooltip-${useId()}`;

  return (
    <span className={styles.tooltipWrap}>
      <button
        className={styles.infoButton}
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
      >
        i
      </button>
      <span
        className={classes(
          styles.tooltip,
          align === "center" && styles.tooltipCenter,
        )}
        id={tooltipId}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
}

export function SwitchField({
  label,
  optional,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  optional?: string;
}) {
  return (
    <label className={classes(styles.switchField, "toggle-row", className)}>
      <input type="checkbox" {...props} />
      <span className={styles.switchVisual} aria-hidden="true">
        <span />
      </span>
      <span>
        {label}
        {optional ? <small>{optional}</small> : null}
      </span>
    </label>
  );
}

export function StatusMessage({
  tone = "info",
  children,
  className,
  role,
}: {
  tone?: "info" | "error" | "success" | "warning";
  children: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      className={classes(styles.status, styles[tone], className)}
      role={role ?? (tone === "error" ? "alert" : "status")}
    >
      {children}
    </div>
  );
}
