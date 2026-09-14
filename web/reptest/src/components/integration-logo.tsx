const artwork = {
  mem0: { file: "mem0-logo.svg", background: "#fff", aspect: 3760 / 1050 },
  hermes: { file: "hermes-logo.webp", background: "#fff", aspect: 1 },
  plow: { file: "plow-logo.png", background: "#171715", aspect: 121 / 63 },
  pi: { file: "pi-logo.svg", background: "#171715", aspect: 1 },
  moonshot: { file: "moonshot-logo.png", background: "#fff", aspect: 1 },
} as const;

/** Supplied artwork; use a label only when no adjacent name is shown. */
export function IntegrationLogo({ provider, size = 24, label = "" }: { provider: keyof typeof artwork; size?: number; label?: string }) {
  const logo = artwork[provider];
  const width = Math.round(size * logo.aspect);
  return (
    <img
      src={`/brand/${logo.file}`}
      alt={label}
      width={width}
      height={size}
      className="inline-block flex-none rounded-sm object-contain"
      style={{ width, height: size, background: logo.background }}
    />
  );
}
