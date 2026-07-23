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

## Safety

Every byte of a drop is attacker-controlled, so the pipeline assumes hostility: zip entries are checked for path traversal and decompression bombs before extraction, builds run in a throwaway non-root container with memory, CPU, pid and wall-clock limits, uploads are size-capped and rate-limited per IP, and anonymous deployments expire on a TTL.

## License

MIT
