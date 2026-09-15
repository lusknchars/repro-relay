import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FillableButton } from "./gsap/fillable-button";

/* ---------------- Button ---------------- */
const buttonVariants = cva(
  "t-control inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-foreground hover:opacity-90 active:opacity-80",
        secondary: "bg-surface border border-border text-foreground hover:bg-surface-2 active:bg-neutral-soft",
        ghost: "text-foreground hover:bg-surface-2 active:bg-neutral-soft",
        outline: "border border-border-strong bg-transparent hover:bg-surface-2",
        danger: "bg-danger text-white hover:opacity-90",
        link: "text-accent-text underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-sm",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  }
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  pending?: boolean;
  outcome?: "success" | "failure" | null;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size, pending, outcome, children, disabled, ...props }, ref) => {
    const fillable = variant !== "ghost" && variant !== "link";
    const Component = fillable ? FillableButton : "button";
    return (
    <Component
      ref={ref}
      {...(fillable ? { variant: variant as "default" | "outline" | "secondary" | "danger" } : {})}
      className={cn(
        buttonVariants({ variant, size }),
        fillable && "rounded-full",
        pending && "pending-sweep",
        outcome === "success" && "bg-ok text-white border-transparent",
        outcome === "failure" && "bg-danger text-white border-transparent",
        className
      )}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {outcome === "success" ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
      {outcome === "failure" ? <X className="h-3.5 w-3.5" aria-hidden /> : null}
      {children}
    </Component>
  );
  }
);
Button.displayName = "Button";

/* ---------------- Badge ---------------- */
const badgeVariants = cva("inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-neutral-soft border-transparent text-muted",
      ok: "bg-ok-soft border-transparent text-ok",
      warn: "bg-warn-soft border-transparent text-warn",
      danger: "bg-danger-soft border-transparent text-danger",
      info: "bg-info-soft border-transparent text-info",
      accent: "bg-accent-soft border-transparent text-accent-text",
      outline: "bg-transparent border-border-strong text-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, dot, children, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

/* ---------------- Card ---------------- */
export function Card({ className, interactive, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      data-glass-panel=""
      className={cn(
        "rounded-lg border border-border bg-surface",
        interactive && "t-control hover:border-border-strong cursor-pointer",
        className
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-3 px-4 pt-3.5 pb-2", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold leading-5", className)} {...props} />;
}
export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

/* ---------------- Input ---------------- */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "t-control h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm placeholder:text-faint focus:border-border-strong disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

/* ---------------- Switch ---------------- */
export function Switch({ checked, onCheckedChange, label, id, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "t-control relative inline-flex h-5 w-9 flex-none items-center rounded-full border border-transparent disabled:opacity-50",
        checked ? "bg-accent" : "bg-border-strong"
      )}
    >
      <span className={cn("t-control inline-block h-4 w-4 rounded-full bg-white shadow-sm", checked ? "translate-x-4" : "translate-x-0.5")} />
    </button>
  );
}

/* ---------------- Segmented ---------------- */
export function Segmented<T extends string>({ value, onChange, options, size = "md", ariaLabel }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md"; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "t-control rounded-sm font-medium",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs",
            value === o.value ? "bg-surface text-foreground shadow-[0_1px_0_rgba(0,0,0,0.04)] border border-border" : "text-muted hover:text-foreground border border-transparent"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-4 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            "t-control -mb-px flex flex-none items-center gap-1.5 whitespace-nowrap border-b-2 py-2 text-sm",
            value === t.value ? "border-accent text-foreground font-medium" : "border-transparent text-muted hover:text-foreground"
          )}
        >
          {t.label}
          {typeof t.count === "number" ? <span className="tnum rounded-sm bg-neutral-soft px-1 text-[11px] text-muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Separator, Kbd, Field ---------------- */
export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />;
}
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="mono rounded-sm border border-border bg-surface-2 px-1 text-[10px] leading-4 text-muted">{children}</kbd>;
}
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span
      className={cn("inline-flex flex-none items-center justify-center rounded-full bg-accent-soft text-accent-text font-semibold", className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* ---------------- Empty state ---------------- */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border-strong p-5">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-prose text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
