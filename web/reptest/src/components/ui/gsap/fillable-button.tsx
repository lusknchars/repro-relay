// Adapted from PaceUI @paceui/gsap-fillable-button.
// Source: https://paceui.com/r/gsap-fillable-button.json
// Retains the pointer-origin circular fill with Relay tokens and accessible states.
import * as React from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

type Variant = "default" | "outline" | "secondary" | "danger";
export interface FillableButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const FillableButton = React.forwardRef<HTMLButtonElement, FillableButtonProps>(
  ({ children, className, variant = "secondary", disabled, ...props }, forwardedRef) => {
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const flairRef = React.useRef<HTMLSpanElement>(null);
    React.useImperativeHandle(forwardedRef, () => buttonRef.current!);

    useGSAP(() => {
      const button = buttonRef.current;
      const flair = flairRef.current;
      if (!button || !flair || disabled) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference) and (hover: hover)", () => {
        const position = (event: MouseEvent) => {
          const rect = button.getBoundingClientRect();
          return {
            xPercent: gsap.utils.clamp(0, 100, ((event.clientX - rect.left) / (rect.width || 1)) * 100),
            yPercent: gsap.utils.clamp(0, 100, ((event.clientY - rect.top) / (rect.height || 1)) * 100),
          };
        };
        const enter = (event: MouseEvent) => {
          gsap.killTweensOf(flair);
          gsap.set(flair, position(event));
          gsap.to(flair, { scale: 1, duration: 0.4, ease: "power2.out", overwrite: true });
        };
        const move = (event: MouseEvent) => {
          gsap.to(flair, { ...position(event), duration: 0.4, ease: "power2.out", overwrite: "auto" });
        };
        const leave = (event: MouseEvent) => {
          const { xPercent: x, yPercent: y } = position(event);
          gsap.to(flair, {
            xPercent: x > 90 ? x + 20 : x < 10 ? x - 20 : x,
            yPercent: y > 90 ? y + 20 : y < 10 ? y - 20 : y,
            scale: 0, duration: 0.3, ease: "power2.out", overwrite: true,
          });
        };
        button.addEventListener("mouseenter", enter);
        button.addEventListener("mousemove", move);
        button.addEventListener("mouseleave", leave);
        return () => {
          button.removeEventListener("mouseenter", enter);
          button.removeEventListener("mousemove", move);
          button.removeEventListener("mouseleave", leave);
          gsap.killTweensOf(flair);
          gsap.set(flair, { clearProps: "all" });
        };
      });
      return () => media.revert();
    }, { scope: buttonRef, dependencies: [disabled, variant], revertOnUpdate: true });

    return (
      <button
        ref={buttonRef}
        data-slot="button"
        data-fillable-button=""
        data-variant={variant}
        disabled={disabled}
        className={cn("relative isolate overflow-hidden rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current", className)}
        {...props}
      >
        <span ref={flairRef} aria-hidden="true" className="pointer-events-none absolute inset-0 origin-top-left scale-0">
          <span className={cn(
            "absolute left-0 top-0 block aspect-square w-[170%] -translate-x-1/2 -translate-y-1/2 rounded-full",
            variant === "outline" || variant === "secondary" ? "bg-foreground/10" : "bg-white/20",
          )} />
        </span>
        <span className="relative z-10 inline-flex items-center justify-center gap-[inherit]">{children}</span>
      </button>
    );
  },
);
FillableButton.displayName = "FillableButton";
