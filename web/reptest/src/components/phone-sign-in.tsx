import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { api, errorText, type Account } from "@/lib/live";

type Completed = {
  authenticated?: boolean;
  needs_profile?: boolean;
  created?: boolean;
};
export function PhoneSignIn({
  account,
  invite,
  onComplete,
  onPassword,
}: {
  account: Account;
  invite: string;
  onComplete: (created: boolean) => void;
  onPassword: () => void;
}) {
  const [step, setStep] = useState<"phone" | "code" | "profile">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [invitation, setInvitation] = useState(invite);
  const [challenge, setChallenge] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null);
  const ready = account.phone_auth?.available === true;
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  useEffect(() => {
    input.current?.focus();
  }, [step]);
  useEffect(() => {
    if (!retryAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const r = await api<{ challenge: string; retry_after: number }>(
      "/account/phone/start",
      "POST",
      { phone },
    );
    setChallenge(r.challenge);
    setCode("");
    setRetryAt(Date.now() + r.retry_after * 1000);
    setClock(Date.now());
    setStep("code");
  }
  async function finish() {
    const r = await api<Completed>("/account/phone/complete", "POST", {
      challenge,
      name,
      invite_token: invitation,
    });
    if (r.needs_profile) {
      setStep("profile");
      return;
    }
    if (!r.authenticated)
      throw new Error("Account verification did not finish. Try again.");
    setChallenge("");
    setCode("");
    onComplete(!!r.created);
  }
  return (
    <section
      className="mx-auto w-full max-w-[352px] py-5"
      aria-label="Phone sign-in"
    >
      <div className="mb-8 flex items-center justify-center gap-2.5">
        <img
          src="/brand/relay-logo-transparent.svg"
          width={28}
          height={28}
          className="h-7 w-7 object-contain"
          alt=""
        />
        <span className="text-lg font-semibold tracking-tight">
          Repro Relay
        </span>
      </div>
      <div className="mb-6 text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          {step === "phone"
            ? "Sign in with your phone"
            : step === "code"
              ? "Check your messages"
              : "Finish your profile"}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {step === "phone"
            ? "Enter your number to sign in or create an account."
            : step === "code"
              ? `Enter the verification code sent to ${phone}.`
              : "Your phone is verified. Add the name your team will see."}
        </p>
      </div>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            if (step === "phone") await send();
            else if (step === "code") {
              await api("/account/phone/verify", "POST", { challenge, code });
              await finish();
            } else await finish();
          });
        }}
      >
        {step === "phone" && (
          <label className="grid gap-2 text-sm font-medium">
            Phone number
            <Input
              ref={input}
              className="h-11"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+55 11 99999 9999"
              required
              maxLength={40}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              aria-describedby="phone-country-hint"
            />
            <span
              id="phone-country-hint"
              className="text-xs font-normal text-muted"
            >
              Include your country code, such as +55 or +1.
            </span>
          </label>
        )}
        {step === "code" && (
          <label className="grid gap-2 text-sm font-medium">
            Verification code
            <Input
              ref={input}
              className="h-12 text-center font-mono text-xl tracking-[0.3em]"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{4,10}"
              required
              minLength={4}
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        )}
        {step === "profile" && (
          <>
            <label className="grid gap-2 text-sm font-medium">
              Display name
              <Input
                ref={input}
                className="h-11"
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {!account.bootstrap_available && (
              <label className="grid gap-2 text-sm font-medium">
                Invitation link or token
                <Input
                  required
                  value={invitation}
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    try {
                      setInvitation(
                        new URLSearchParams(new URL(value).hash.slice(1)).get(
                          "invite",
                        ) || value,
                      );
                    } catch {
                      setInvitation(value);
                    }
                  }}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {step === "phone" && !ready && (
          <div
            className="rounded-lg border border-border bg-surface-2 p-3 text-sm"
            role="status"
          >
            <p className="font-medium">SMS sign-in needs a connection</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              The workspace owner connects the SMS service once. Then everyone
              can sign in here with a code.
            </p>
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium">
                Server setup
              </summary>
              <p className="mt-2 leading-relaxed">
                Add the Twilio Verify credentials to the server’s private .env
                file, then restart Relay.
              </p>
              <ul className="mt-2 space-y-1 break-all font-mono">
                <li>RELAY_TWILIO_ACCOUNT_SID</li>
                <li>RELAY_TWILIO_AUTH_TOKEN</li>
                <li>RELAY_TWILIO_VERIFY_SERVICE_SID</li>
              </ul>
              <p className="mt-2">
                Your Plow line remains a separate connection.
              </p>
            </details>
          </div>
        )}
        <Button
          variant="default"
          type="submit"
          className="h-11 w-full justify-center"
          pending={busy}
          disabled={step === "phone" && (!ready || remaining > 0)}
        >
          {step === "phone"
            ? "Send verification code"
            : step === "code"
              ? "Verify & continue"
              : "Create account"}
          <ArrowRight size={15} aria-hidden />
        </Button>
        {step === "phone" && remaining > 0 && (
          <p role="status" className="text-xs text-muted">
            You can request another code in {remaining}s.
          </p>
        )}
        {step === "code" && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy || remaining > 0}
            onClick={() => void perform(send)}
          >
            {remaining > 0 ? `Resend in ${remaining}s` : "Resend code"}
          </Button>
        )}
        {step !== "phone" && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setStep("phone");
              setChallenge("");
              setCode("");
              setError("");
            }}
          >
            <ArrowLeft size={14} /> Change phone number
          </Button>
        )}
      </form>
      {step === "phone" && (
        <>
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
            We use your number to verify sign-in. This does not subscribe you to
            team messages.
          </p>
          <div className="mt-6 border-t border-dashed border-border pt-4 text-center">
            <Button type="button" variant="link" onClick={onPassword}>
              Use an existing username account
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
