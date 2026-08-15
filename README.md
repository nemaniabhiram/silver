# silver

Drop a folder. Or a zip. Your static site goes live in seconds on its own subdomain. No account, no configuration.

```
drop folder/zip → uploading → queued → building → READY → https://x7k2m9qw4p.example.com
```

Pre-built HTML/CSS/JS goes live as-is. A Vite or Create React App project gets built in a sandboxed container first, and the build output is what ships.

## How it works

Four small services that never talk to each other directly. All coordination goes through Postgres, all files through object storage.

| Service           | Role                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/api`        | Accepts uploads, creates deployments, serves status and logs              |
| `apps/worker`     | Claims queued deployments, extracts, builds, uploads the output           |
| `apps/serve`      | Maps `<id>.domain` to a deployment and streams its files                  |
| `apps/web`        | The drop page and the deployment status page                              |
| `packages/shared` | Config, the deployment status machine, migrations, storage and id helpers |

Deployments are a table that doubles as the queue: the worker claims rows with `FOR UPDATE SKIP LOCKED`. There is no message broker and no internal RPC.

Build logs and status changes reach the browser the same way. The worker announces on a Postgres channel, the api listens on it and pushes over Server-Sent Events, and the two still never speak to each other. Each event is identified by the log row's own `bigserial`, which is also what the browser sends back as `Last-Event-ID`, so a dropped connection resumes exactly where it stopped without losing or repeating a line. Polling remains as the fallback, because a proxy that buffers the stream would otherwise leave the page silent.

This is streaming with resumption rather than anything real-time. The worker batches log writes at fifty lines or half a second, which is what keeps a chatty `npm install` to a handful of inserts instead of hundreds, so the floor is around half a second rather than zero. Removing that would mean the worker talking to the api directly, which costs the architecture more than the difference is worth.

## Running it locally

Requires Node 22, pnpm 10, and Docker Desktop.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres on :5433, MinIO on :9000 (console :9001)
pnpm dev           # api :4000 · serve :4001 · web :5173 · worker polling
```

Migrations run automatically at startup under an advisory lock, so services can boot in any order or all at once.

Deployed sites are reachable at `http://<id>.localhost:4001`. Browsers resolve `*.localhost` themselves, so no hosts-file editing is needed.

```bash
pnpm fixtures      # generate test zips into fixtures/
pnpm test          # unit tests
pnpm typecheck
pnpm smoke         # end-to-end: upload → poll → fetch the live site
```

## Performance

Measured with `pnpm bench` (the script is in [scripts/bench.mjs](scripts/bench.mjs)) on a dev laptop, over loopback, against local MinIO, so network RTT is excluded and these are single-node numbers, not a distributed-load claim:

- **Drop → live in under 2 seconds** for a pre-built static site (median 1.5 s over 5 runs, from starting the upload to the first 200 from the live subdomain)
- **~800 req/s sustained on the serve hot path** at concurrency 50, with p50 59 ms / p99 96 ms
- **69% fewer bytes over the wire.** Deploying Silver's own production bundle, a full page load goes from 299 KB to 91 KB: the 279 KB JavaScript chunk ships as 84 KB, the 20 KB stylesheet as 6 KB

The serve path stays this flat because status lookups are cached per site per minute, so nearly every request is a single S3 GET streamed through.

Compression is the same story. Files are Brotli-compressed once by the worker and stored beside their originals, so serving one is still a single read streamed through, and the request path does no compression work at all. Assets that already carry their own compression, and anything under a kilobyte, are left alone. A client that does not offer Brotli gets the original, and every response that could have been either says so with `Vary: Accept-Encoding`.

## Safety

Every byte of a drop is attacker-controlled, so the pipeline assumes hostility: zip entries are checked for path traversal and decompression bombs before extraction, builds run in a throwaway non-root container with memory, CPU, pid and wall-clock limits, uploads are size-capped and rate-limited per IP, and anonymous deployments expire on a TTL.

Deploy quota is spent on deployments created rather than uploads attempted, so mistakes don't lock anyone out; a separate, more generous ceiling on attempts keeps flooding pointless.

## Not built yet

Everything above runs locally. Production deployment does not exist: there are no per-app Dockerfiles, no reverse proxy config, no wildcard DNS or TLS setup, and no metrics endpoint. Going live means building those, pointing `S3_*` at Cloudflare R2 (or any S3 API), and fronting `*.<domain>` with a proxy routing to `serve` while the apex serves `apps/web`.

Also absent by design: accounts, git integration, custom domains, preview deployments, and server-side rendering.

## License

MIT
