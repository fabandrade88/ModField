# ModField

Ferramenta web de diagnóstico, simulação e registro Modbus. A especificação fica no Outline, na coleção **Modbus Tool**.

Estado atual: **fase 4 (data logger e gráficos)**. Coleta no agente com buffer em disco e sincronização por sequência, ou no navegador com a aba aberta; blocos binários no IndexedDB; gráfico uPlot com 8 penas, dois eixos, zoom e marcadores; estatísticas da janela; CSV; arquivo de projeto `.modfield`. Fase 3: Além do modo sem agente: agente em Go com pareamento e autenticação mútua, Modbus TCP, RTU pelo agente com os nomes reais das portas, varredura de IP e simulador TCP. Fase 2: RTU pela Web Serial e modo demonstração no navegador: perfis, tags com leitura agrupada, escrita com confirmação, scanner (IDs, parâmetros, escuta passiva, registradores), cadastro de equipamentos com 43/14, monitor de tráfego e paleta de comandos.

## Rodar

```sh
mise install          # Node 26 e pnpm 12, fixados em mise.toml
pnpm install
pnpm dev              # http://localhost:3000/pt/
```

Build estático (o que vai para a hospedagem), com a CSP aplicada:

```sh
pnpm build            # gera apps/web/out/
pnpm --filter @modfield/web serve   # http://127.0.0.1:3100/pt/
```

## Agente local

```sh
cd agent
go run ./cmd/modfield-agent --dev --sim 127.0.0.1:5020   # aceita http://localhost:3000; simulador de demonstração
go run ./cmd/modfield-agent pair                         # mostra o código de pareamento no terminal (sem tela)
```

Escuta só em `127.0.0.1:47807` (ou 47808/47809). Dados (chave, navegadores pareados) em `%LOCALAPPDATA%\ModField`, `~/Library/Application Support/ModField` ou `~/.local/share/modfield`. Para o agente servir a própria interface: `pnpm build && sh scripts/embed-ui.sh` antes de compilar.

Instaladores sem administrador em `agent/installer/` (Inno Setup, LaunchAgent, `systemd --user` e `install.sh`). O release está em `agent/.goreleaser.yaml` e `.github/workflows/release-agent.yml`. A assinatura de código depende dos certificados, que ainda são decisão em aberto.

## Testes

```sh
pnpm test             # Vitest: protocol, transport (inclui integração com o agente real), ui
(cd agent && go test -race ./...)   # agente: Modbus, simulador, pareamento, servidor, atualização
pnpm typecheck
pnpm build && pnpm test:e2e         # Playwright (Chromium e Firefox) contra o build estático e o agente real
```

Localmente, o Playwright aceita qualquer navegador baseado em Chromium:
`PLAYWRIGHT_CHROMIUM=/usr/bin/brave pnpm test:e2e`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `packages/protocol` | CRC-16, PDUs (01–06, 15, 16, 43/14), enquadramento RTU por tamanho esperado, tipos de dados e ordem de bytes, endereçamento, códigos de erro, tipos JSON-RPC do agente |
| `packages/transport` | Interface `Transport`, `WebSerialTransport`, `MockTransport` (o mesmo código RTU numa linha serial simulada), `ModbusClient`, escravos simulados com geradores |
| `packages/series` | Blocos de amostras (13 bytes/amostra), estatísticas, redução de pontos para o gráfico, CSV canônico |
| `packages/ui` | Temas (Tokyo Night, alto contraste claro, Gruvbox, Nord, Catppuccin) e teste de contraste WCAG AA |
| `agent` | Agente em Go: Modbus RTU/TCP próprio (com quadros brutos para o monitor), simulador, pareamento Ed25519/HMAC, WebSocket JSON-RPC, bandeja, atualização assinada |
| `apps/web` | Next.js com export estático: shell em mosaico, módulos, i18n (pt, en, de), CSP por hash |

Depois de mudar `packages/ui/src/themes.ts`, rode `pnpm --filter @modfield/ui gen` para regenerar `themes.css`. Um teste falha se os dois divergirem.
