#!/usr/bin/env node
// Regenerates every test zip under fixtures/. Fixtures are generated, never committed.
import { deflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const fixtures = {
  "static-site.zip": {
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Silver fixture</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <h1>silver static fixture</h1>
    <img src="pixel.png" alt="" />
    <script src="app.js"></script>
  </body>
</html>
`,
    "style.css": "body { background: #0a0a0a; color: #fafafa; font-family: system-ui; }\n",
    "app.js": "document.querySelector('h1').dataset.ready = 'true';\n",
    "pixel.png": PIXEL_PNG,
  },

  "nested-root.zip": {
    "my-site/index.html": "<!doctype html><title>nested</title><h1>nested root</h1>\n",
    "my-site/style.css": "body { color: #fafafa; }\n",
  },

  "zip-slip.zip": {
    "index.html": "<!doctype html><title>slip</title>\n",
    "../evil.txt": "should never be written outside the workspace\n",
  },

  "no-index.zip": {
    "readme.txt": "no index.html and no package.json — undeployable\n",
  },

  "vite-app.zip": {
    "package.json": JSON.stringify(
      {
        name: "vite-fixture",
        private: true,
        type: "module",
        scripts: { build: "vite build" },
        devDependencies: { vite: "^6.3.4" },
      },
      null,
      2,
    ),
    "index.html": `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Vite fixture</title></head>
  <body><div id="app"></div><script type="module" src="/main.js"></script></body>
</html>
`,
    "main.js": "document.querySelector('#app').textContent = 'built by vite';\n",
  },

  "failing-build.zip": {
    "package.json": JSON.stringify(
      {
        name: "failing-fixture",
        private: true,
        scripts: { build: "node -e \"process.exit(1)\"" },
      },
      null,
      2,
    ),
    "index.html": "<!doctype html><title>fails</title>\n",
  },

  "hanging-build.zip": {
    "package.json": JSON.stringify(
      {
        name: "hanging-fixture",
        private: true,
        scripts: { build: "node -e \"setTimeout(()=>{},1e9)\"" },
      },
      null,
      2,
    ),
    "index.html": "<!doctype html><title>hangs</title>\n",
  },

  "chatty-build.zip": {
    "package.json": JSON.stringify(
      {
        name: "chatty-fixture",
        private: true,
        scripts: {
          build:
            "node -e \"const fs=require('fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','<h1>chatty</h1>');for(let i=0;i<40000;i++)console.log('noise line '+i+' '.repeat(20))\"",
        },
      },
      null,
      2,
    ),
    "index.html": "<!doctype html><title>chatty</title>\n",
  },
};

await mkdir(FIXTURES_DIR, { recursive: true });
for (const [name, files] of Object.entries(fixtures)) {
  await writeFile(resolve(FIXTURES_DIR, name), buildZip(files));
  console.log(`fixtures/${name}  (${Object.keys(files).length} entries)`);
}

/**
 * Minimal zip writer. Hand-rolled so fixtures need no dependency and so
 * `zip-slip.zip` can hold a path that real zip tools refuse to produce.
 */
function buildZip(files) {
  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const [path, content] of Object.entries(files)) {
    const name = Buffer.from(path, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, name, compressed);
    entries.push({ name, crc, compressedSize: compressed.length, size: data.length, offset });
    offset += localHeader.length + name.length + compressed.length;
  }

  const central = [];
  let centralSize = 0;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.compressedSize, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);

    central.push(header, entry.name);
    centralSize += header.length + entry.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
