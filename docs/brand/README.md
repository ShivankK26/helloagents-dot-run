# Brand

The mark is **Merge**: three lines, one per agent, meet in a single coral point, the merged result. It is drawn on a 32-unit grid with 3-unit round strokes so it holds up as a 16px favicon. Coral is used only for the result dot.

| File             | Use                                                    |
| ---------------- | ------------------------------------------------------ |
| `mark-dark.svg`  | Mark for dark backgrounds                              |
| `mark-light.svg` | Mark for light backgrounds                             |
| `app-icon.svg`   | Square icon on a solid background (avatars)            |
| `app-icon.html`  | Source for the macOS app icon, `apps/desktop/resources/icon.png` |
| `og-image.html`  | Source for `apps/web/public/og-image.png`              |

Colors: ink `#101214` (dark mode `#ecedef`), paper `#f6f6f2`, accent `#f25a24` (dark mode `#ff7a3d`).
Wordmark: `helloagents` in Geist SemiBold on the web, IBM Plex Sans SemiBold in the app. Product UI uses IBM Plex Sans and IBM Plex Mono.

Regenerate the link-preview image with headless Chrome:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=apps/web/public/og-image.png "file://$PWD/docs/brand/og-image.html"
```

Regenerate the app icon (1024×1024, macOS icon grid) the same way:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1024,1024 --default-background-color=00000000 \
  --screenshot=apps/desktop/resources/icon.png "file://$PWD/docs/brand/app-icon.html"
```
