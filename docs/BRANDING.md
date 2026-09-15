# Repro Relay logo

The purple orbital artwork supplied on September 14 is the current app logo. The two original SVGs are preserved in `web/reptest/public/brand/repo-relay-icon.svg` and `repo-relay-icon-transparent.svg`.

The sidebar, account entry, favicon, macOS bundle and README app image use derivatives of the transparent source. The display canvas removes empty outer margins; the artwork itself is unchanged. Both legacy `mark-black.png` and `mark-white.png` paths now contain the same full-color logo, so existing theme-aware views continue to work.

After installing the web dependencies, regenerate all active assets from the repository root:

```sh
node scripts/generate-brand-icons.mjs
make desktop-build
```

The generator uses Tauri's icon renderer and retains only the web and existing desktop formats. Original supplied SVGs are never overwritten.
