import { useRef, useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui";

export function AddSkills() {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  async function read(file?: File) {
    const current = ++generation.current;
    setPreview("");
    setError("");
    setReading(false);
    if (!file) return;
    if (file.name !== "SKILL.md" || !file.size || file.size > 128 * 1024) {
      setError("Choose a non-empty SKILL.md file, up to 128 KB. ZIP files and folders are not supported yet.");
      return;
    }
    setReading(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      if (current !== generation.current) return;
      if (!text.trim() || text.includes("\0")) throw new Error("Not a text file");
      setPreview(text);
    } catch {
      if (current === generation.current) setError("This file could not be read as UTF-8 text. Choose another SKILL.md file.");
    } finally {
      if (current === generation.current) setReading(false);
    }
  }

  return (
    <>
      <Button ref={trigger} variant="default" size="lg" onClick={() => dialog.current?.showModal()}>
        <Plus size={16} aria-hidden /> Add skills
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="add-skills-title"
        aria-describedby="add-skills-description"
        className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/60"
        onClose={() => {
          generation.current++;
          setReading(false);
          setPreview("");
          setError("");
          const input = dialog.current?.querySelector("input");
          if (input) input.value = "";
          trigger.current?.focus();
        }}
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="add-skills-title" className="text-lg font-semibold">Add skills</h2>
          <Button aria-label="Close add skills" variant="ghost" size="lg" onClick={() => dialog.current?.close()}>
            <X size={18} aria-hidden />
          </Button>
        </header>
        <p id="add-skills-description" className="mb-4 text-sm text-muted">
          Select a SKILL.md file from your computer to inspect its instructions. The file stays on this device and is not sent to an agent.
        </p>
        <label className="grid gap-3 rounded-lg border border-dashed border-border-strong p-4 text-sm">
          <span className="flex items-center gap-2 font-medium"><Upload size={18} aria-hidden /> Upload skill file</span>
          <input autoFocus aria-label="Upload skill file" type="file" accept=".md,text/markdown" className="block w-full min-w-0 text-sm" onChange={(event) => void read(event.target.files?.[0])} />
          <span className="text-xs text-muted">SKILL.md only, up to 128 KB. Preview only; not saved after closing.</span>
        </label>
        {reading && <p role="status" className="mt-3 text-sm">Reading file…</p>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {preview && (
          <section aria-label="Skill file preview" className="mt-4 min-w-0">
            <h3 className="mb-2 text-sm font-medium">File preview</h3>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface-2 p-3 text-xs">{preview}</pre>
          </section>
        )}
        <p className="mt-4 rounded-md border border-border p-3 text-sm text-muted">
          Skill installation is not connected yet. Previewing a file does not validate compatibility, install scripts or enable it in Hermes, Claude Code or Codex. Your active workflow stays unchanged.
        </p>
        <footer className="mt-4 flex justify-end">
          <Button size="lg" onClick={() => dialog.current?.close()}>Done</Button>
        </footer>
      </dialog>
    </>
  );
}
