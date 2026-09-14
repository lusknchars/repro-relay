/** Supplied artwork; adjacent labels provide the accessible name. */
export function IntegrationLogo({ provider, size = 24 }: { provider: "hermes" | "plow"; size?: number }) {
  return (
    <img
      src={`/brand/${provider}-logo.${provider === "hermes" ? "webp" : "png"}`}
      alt=""
      width={provider === "plow" ? Math.round(size * 1.92) : size}
      height={size}
      className="inline-block flex-none rounded-sm object-contain"
      style={{ width: provider === "plow" ? Math.round(size * 1.92) : size, height: size, background: provider === "hermes" ? "#fff" : "#171715" }}
    />
  );
}
