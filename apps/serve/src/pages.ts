const PAGE_STYLE = `
  :root { color-scheme: dark; }
  body {
    margin: 0;
    min-height: 100dvh;
    display: grid;
    place-content: center;
    gap: 12px;
    text-align: center;
    background: #0a0a0a;
    color: #fafafa;
    font-family: Inter, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  h1 { margin: 0; font-size: 24px; font-weight: 600; }
  p { margin: 0; font-size: 14px; color: #a1a1aa; }
  a { color: #fafafa; }
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
