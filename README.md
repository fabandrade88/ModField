# ModField

Ferramenta web de diagnóstico, simulação e registro Modbus. A especificação fica no Outline, na coleção **Modbus Tool**.

Estado atual: **fase 1 (fundação)**. O modo sem agente está começando: RTU pela Web Serial e modo demonstração no navegador.

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

## Testes

```sh
pnpm test             # Vitest: protocol, transport, ui
pnpm typecheck
pnpm build && pnpm test:e2e         # Playwright contra o build estático
```

Localmente, o Playwright aceita qualquer navegador baseado em Chromium:
`PLAYWRIGHT_CHROMIUM=/usr/bin/brave pnpm test:e2e`.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `packages/protocol` | CRC-16, PDUs (01–06, 15, 16, 43/14), enquadramento RTU por tamanho esperado, tipos de dados e ordem de bytes, endereçamento, códigos de erro, tipos JSON-RPC do agente |
| `packages/transport` | Interface `Transport`, `WebSerialTransport`, `MockTransport` (o mesmo código RTU numa linha serial simulada), `ModbusClient`, escravos simulados com geradores |
| `packages/ui` | Temas (Tokyo Night, alto contraste claro, Gruvbox, Nord, Catppuccin) e teste de contraste WCAG AA |
| `apps/web` | Next.js com export estático: shell em mosaico, módulos, i18n (pt, en, de), CSP por hash |

Depois de mudar `packages/ui/src/themes.ts`, rode `pnpm --filter @modfield/ui gen` para regenerar `themes.css`. Um teste falha se os dois divergirem.
