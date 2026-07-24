# silver

Drop a folder. Or a zip. Your static site goes live in seconds on its own subdomain — no account, no configuration.

```
drop folder/zip → uploading → queued → building → READY → https://x7k2m9qw4p.example.com
```

Pre-built HTML/CSS/JS goes live as-is. A Vite or Create React App project gets built in a sandboxed container first, and the build output is what ships.

## How it works

Four small services that never talk to each other directly. All coordination goes through Postgres, all files through object storage.

| Service | Role |
|---|---|
| `apps/api` | Accepts uploads, creates deployments, serves status and logs |
| `apps/worker` | Claims queued deployments, extracts, builds, uploads the output |
| `apps/serve` | Maps `<id>.domain` to a deployment and streams its files |
| `apps/web` | The drop page and the deployment status page |
| `packages/shared` | Config, the deployment status machine, migrations, storage and id helpers |

Deployments are a table that doubles as the queue — the worker claims rows with `FOR UPDATE SKIP LOCKED`. There is no message broker and no internal RPC.

## Running it locally

Requires Node 22, pnpm 10, and Docker Desktop.

```bash
pnpm install
cp .env.example .env
pnpm infra:up      # Postgres on :5433, MinIO on :9000 (console :9001)
pnpm dev           # api :4000 · serve :4001 · web :5173 · worker polling
```

Migrations run automatically at startup under an advisory lock, so services can boot in any order or all at once.

Deployed sites are reachable at `http://<id>.localhost:4001` — browsers resolve `*.localhost` themselves, so no hosts-file editing is needed.

```bash
pnpm fixtures      # generate test zips into fixtures/
pnpm test          # unit tests
pnpm typecheck
pnpm smoke         # end-to-end: upload → poll → fetch the live site
```

## Performance

Measured with `pnpm bench` (the script is in [scripts/bench.mjs](scripts/bench.mjs)) on a dev laptop, over loopback, against local MinIO — so network RTT is excluded and these are single-node numbers, not a distributed-load claim:

- **Drop → live in under 2 seconds** for a pre-built static site (median 1.5 s over 5 runs, from starting the upload to the first 200 from the live subdomain)
- **~800 req/s sustained on the serve hot path** at concurrency 50, with p50 59 ms / p99 96 ms

The serve path stays this flat because status lookups are cached per site per minute, so nearly every request is a single S3 GET streamed through.

## Safety

Every byte of a drop is attacker-controlled, so the pipeline assumes hostility: zip entries are checked for path traversal and decompression bombs before extraction, builds run in a throwaway non-root container with memory, CPU, pid and wall-clock limits, uploads are size-capped and rate-limited per IP, and anonymous deployments expire on a TTL.

Deploy quota is spent on deployments created rather than uploads attempted, so mistakes don't lock anyone out; a separate, more generous ceiling on attempts keeps flooding pointless.

## Not built yet

Everything above runs locally. Production deployment does not exist: there are no per-app Dockerfiles, no reverse proxy config, no wildcard DNS or TLS setup, and no metrics endpoint. Going live means building those, pointing `S3_*` at Cloudflare R2 (or any S3 API), and fronting `*.<domain>` with a proxy routing to `serve` while the apex serves `apps/web`.

Also absent by design: accounts, git integration, custom domains, preview deployments, and server-side rendering.

## License

MIT
