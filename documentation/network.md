# Network access and Docker

By default the engine listens on `127.0.0.1:9656`: only the computer it runs on can open the UI.
This page covers how to let other machines in (a container, a colleague's laptop, a team server),
how the setting is decided, and a Docker setup that has been run end to end.

> **There is no login.** Anyone who can reach the port can read every session the engine
> indexes: prompts, answers, tool output, file contents. Only open it on a network you trust, or
> put it behind something that authenticates (an SSH tunnel, a reverse proxy with auth, a VPN).

## Choosing the address

| Where | How | Effect |
|---|---|---|
| Command line | `yolo-twice start --host 0.0.0.0` (also `open`) | Listens there; the UI shows it and cannot change it |
| Environment | `YOLO_TWICE_HOST=0.0.0.0` | Same as `--host` (the Docker image sets this) |
| UI | Settings ▸ Network: *This computer* / *All networks* | Re-binds at once, no restart; remembered in `~/.yolo-twice/settings.json` |
| Default | | `127.0.0.1`, this computer only |

Precedence: `--host`, then `YOLO_TWICE_HOST`, then the UI's remembered choice, then `127.0.0.1`.
A remembered address that no longer exists (another network) falls back to `127.0.0.1` with a
note in the log; one given with `--host` or the environment is an error instead.

Useful values:

- `127.0.0.1`: this computer only (default).
- `0.0.0.0`: every IPv4 interface, and loopback keeps working. This is the one to use in Docker.
- `::`: every interface, IPv6 included.
- A single interface address, e.g. `192.168.1.20`: only that address answers. This leaves out
  `localhost`, and with it the Claude Code hooks (they post to `127.0.0.1`), so prefer `0.0.0.0`.

The port is set separately: `--port` or `YOLO_TWICE_PORT` (default 9656).

When the engine is reachable from elsewhere, it says so on start:

```
yolo-twice engine 0.1.2 listening on http://127.0.0.1:9656
yolo-twice: reachable from other machines (http://192.168.21.59:9656), without a login: anyone who can reach this port can read your sessions
```

`yolo-twice status` prints the address too, and the settings menu lists the URLs others can use,
with the same warning.

### API

`GET /api/network`

```json
{ "host": "0.0.0.0", "port": 9656, "exposed": true, "urls": ["http://192.168.21.59:9656"], "lockedBy": "--host" }
```

- `exposed`: listening on anything but loopback.
- `urls`: the addresses others can use. It's empty inside a container, where `container: true`
  says to use the port published on the host instead.
- `lockedBy`: present when the address was given at start (`--host` or `YOLO_TWICE_HOST`).

`PUT /api/network` with `{ "host": "0.0.0.0" }` re-binds on the same port and answers before the
switch, since the switch closes open connections (pages reconnect by themselves). The status codes:

- **400:** an address that isn't this machine's.
- **409:** the address was locked at start.

Implementation: `Engine.rebind` and `Engine.network` in `code/packages/engine/src/server.ts`,
`--host` in `cli.ts`, settings and address helpers in `state.ts`, the menu in
`code/packages/ui/src/Header.tsx` (`NetworkSetting`), tests in
`code/packages/engine/test/network.test.ts`.

## Docker

The image (`code/Dockerfile`) bundles the engine like the npm package, with the UI next to it,
and starts it on `0.0.0.0` through `YOLO_TWICE_HOST`, so the settings menu shows the address
read-only. It does not run Claude: summaries fall back to the structural ones unless a
summarizer is available in the container.

Build it from `code/`:

```sh
cd code
docker build -t yolo-twice .
```

Run it from your project's root:

```sh
docker run -d --name yolo-twice \
  -p 9656:9656 \
  -u "$(id -u):$(id -g)" -e HOME="$HOME" -e USER="$USER" \
  -v "$HOME/.claude/projects:/claude/projects:ro" \
  -v "$PWD:$PWD" -w "$PWD" \
  yolo-twice
```

Then open `http://localhost:9656/`, or `http://<this machine>:9656/` from elsewhere.

Why each part is there:

| Part | Reason |
|---|---|
| `-p 9656:9656` | Publishes the port on the host. Claude Code's hooks on the host post to `127.0.0.1:9656`, which this reaches, so live updates and "Claude is working" keep working. |
| `-v "$PWD:$PWD" -w "$PWD"` | The project at the same path as on the host. The engine finds a project's Claude transcripts by its path, and the hooks report your path. |
| `-v "$HOME/.claude/projects:/claude/projects:ro"` | Only the transcripts, read-only; your Claude credentials stay out (`CLAUDE_CONFIG_DIR=/claude` in the image). |
| `-u "$(id -u):$(id -g)"` | The `.yolo-twice` folder it writes into your project belongs to you, not root. |
| `-e HOME="$HOME" -e USER="$USER"` | Paths in the transcripts are rewritten to `~` and `<user>` as they are outside the container. |

Optional:

- `-v yolo-twice-data:/data` keeps the engine's own state (registered projects, the log) between
  containers. Session data lives in your project either way.
- `-v "$HOME/.gitconfig:$HOME/.gitconfig:ro"` gives auto-commit your git identity.
- `-p 127.0.0.1:9656:9656` publishes on the host's loopback only: the container is reachable
  from this machine but not from the network.

Stop it with `docker rm -f yolo-twice`. Don't run the engine on the host at the same time: both
would claim port 9656 and write the same `.yolo-twice` folder.

### Checking it

```sh
curl -s localhost:9656/api/network
# {"host":"0.0.0.0","port":9656,"exposed":true,"urls":[],"lockedBy":"YOLO_TWICE_HOST","container":true}
docker logs yolo-twice
# … listening on http://127.0.0.1:9656
# yolo-twice: reachable from other machines through the port published for this container, without a login: …
# … hook Stop 34b27ceb -> idle        (a hook from Claude Code on the host arrived)
```

This setup was verified with a test project:
- The UI and the session were served on the published port and over the LAN.
- The address showed as locked in the settings.
- The `.yolo-twice` files belonged to the host user.
- A hook posted on the host reached the container.
