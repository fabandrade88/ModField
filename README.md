# ModField

Read, write, scan and log Modbus RTU and TCP devices, and produce the commissioning report. Over USB-RS485 it works with nothing to install; the local agent adds TCP networks and logging with the tab closed.

**[modfield.app](https://modfield.app)** · Docs in [Português](https://modfield.app/pt/docs/), [English](https://modfield.app/en/docs/), [Deutsch](https://modfield.app/de/docs/)

- **Browser only:** RTU over Web Serial, reads, confirmed writes, scanner, traffic monitor, logger, PDF report, demo bench. Works offline.
- **With the agent** (Go, no admin rights, `127.0.0.1` only): Modbus TCP, IP scan, logging with the tab closed, slave simulator, signed reports.

## Develop

```sh
mise install && pnpm install
pnpm dev                                   # http://localhost:3000/pt/
pnpm build                                 # static site in apps/web/out/
cd agent && go run ./cmd/modfield-agent --dev --sim 127.0.0.1:5020
```

## Test

```sh
pnpm test                                  # unit (Vitest)
(cd agent && go test -race ./...)          # agent
pnpm build && pnpm test:e2e                # Playwright, Chromium and Firefox
```

## Layout

| Path | |
|---|---|
| `apps/web` | Next.js static app and the docs (`content/docs/{pt,en,de}`) |
| `packages/*` | Modbus protocol, transports, series, PDF report, UI themes |
| `agent` | Local agent in Go, installers in `agent/installer` |
| `scripts` | Agent distribution and installer tests |

## License

[MIT](LICENSE) © [Fabricio Andrade](https://www.linkedin.com/in/fabriciodeandrade/)
