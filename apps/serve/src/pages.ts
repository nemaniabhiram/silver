/**
 * These pages are the first thing a stranger following a dead link sees, so
 * they follow the OS theme in the same warm neutrals as the app. The values are
 * copied from the design tokens rather than imported: this service ships no
 * stylesheet, and a self-contained page is worth one duplicated palette.
 */
const PAGE_STYLE = `
  :root {
    color-scheme: light;
    --bg: #faf9f5;
    --text: #1a1915;
    --text-dim: #6b6a60;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #1f1e1c;
      --text: #f5f4ee;
      --text-dim: #b9b6ab;
    }
  }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    background: var(--bg);
    color: var(--text);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 { margin: 0; font-size: 24px; font-weight: 600; letter-spacing: -0.01em; }
  p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--text-dim); }
  a { color: var(--text); }
`;

function page(title: string, heading: string, detail: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${PAGE_STYLE}</style>
  </head>
  <body>
    <h1>${heading}</h1>
    <p>${detail}</p>
  </body>
</html>
`;
}

export const NOT_FOUND_PAGE = page(
  "Nothing here",
  "There's no site here.",
  "This address doesn't point at a deployment.",
);

export const EXPIRED_PAGE = page(
  "Site expired",
  "This site has expired.",
  "Deployments are removed after their retention window. Drop it again to bring it back.",
);

export const UNAVAILABLE_PAGE = page(
  "Temporarily unavailable",
  "This site is temporarily unavailable.",
  "Something on our side is not answering. The deployment is fine; try again in a moment.",
);
