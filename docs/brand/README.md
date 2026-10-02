# Brand

The mark is a speech bubble ("hello") holding a terminal prompt `›` and a cursor: talking to agents from the command line.

| File             | Use                                                    |
| ---------------- | ------------------------------------------------------ |
| `mark-dark.svg`  | Mark for dark backgrounds                              |
| `mark-light.svg` | Mark for light backgrounds                             |
| `app-icon.svg`   | Square icon on a solid background (app icons, avatars) |
| `og-image.html`  | Source for `apps/web/public/og-image.png`              |

Colors: ink `#0b0b0c`, paper `#ededef` / `#fafafa`, background `#09090b`, accent (cursor) `#ff7a3d`.
Wordmark: `helloagents` in IBM Plex Sans SemiBold. Product UI uses IBM Plex Sans and IBM Plex Mono.

Regenerate the link-preview image with headless Chrome:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=4000 \
  --screenshot=apps/web/public/og-image.png "file://$PWD/docs/brand/og-image.html"
```
