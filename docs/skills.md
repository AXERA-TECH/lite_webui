# Lite WebUI agent guide

This document gives coding agents and new developers the minimum mental model
needed to work on Lite WebUI safely. Read it before changing code or suggesting
deployment steps.

## Product boundary

Lite WebUI is a **local-first, browser-only demo UI** for OpenAI-compatible
inference endpoints. It intentionally does not contain its own backend, model
runtime, account system, telemetry pipeline, or cloud dependency.

The browser talks directly to:

- the configured OpenAI-compatible model endpoint;
- optional image/audio endpoints exposed by that endpoint;
- an optional read-only AX8860 metrics aggregator.

Conversations, settings, endpoints, model selections, and capability overrides
are stored in the browser's `localStorage`. They are not uploaded by Lite WebUI.

## Non-negotiable rules

1. Do not add a cloud model API, web-search backend, analytics service, or other
   implicit network dependency without an explicit product decision.
2. Do not put API keys, tokens, passwords, board addresses, or private network
   IPs in source, tests, documentation, or Git history.
3. Use `<board-ip>`, `<monitor-host>`, and `<provider-key>` placeholders in
   public documentation.
4. Preserve the OpenAI-compatible subset described in `README.md`. Unknown
   response fields may be ignored, but existing generic servers must continue to
   work.
5. Keep the frontend static. Node.js is a development/build dependency only;
   it is not required on the AX8860 board.
6. Run the full test and build suite before reporting work as complete.

## Source map

| Path | Purpose |
|---|---|
| `src/api.js` | Endpoint normalization, model discovery, chat completions, streaming, image/audio APIs, usage metrics |
| `src/store.js` | Settings, endpoints, model capabilities, model profiles, conversations, and other browser-local state |
| `src/context.js` | Approved context presets and auto-reset calculations |
| `src/capabilities.js` | Per-model Vision/Audio/Draw/Speak capability detection and overrides |
| `src/documents.js` | Browser-side text extraction from documents |
| `src/audio.js` | Audio capture/transcription and speech playback helpers |
| `src/components/app.js` | Application composition and request lifecycle |
| `src/components/chat.js` | Conversation rendering, markdown, thinking blocks, metrics, and branching |
| `src/components/input-bar.js` | Composer, multimodal input, commands, and context badge |
| `src/components/settings-modal.js` | Endpoints, context presets, capability and generation settings |
| `src/components/health-panel.js` | Endpoint checks and optional AX8860 device metrics |
| `src/components/model-picker.js` | Model selection and capability presentation |
| `tests/` | Vitest unit and component tests, including jsdom integration coverage |

## Commands

```bash
npm install        # once, or after dependency changes
npm run dev        # Vite development server
npm test           # complete Vitest suite
npm run test:watch # iterative development
npm run build      # static production bundle in dist/
npm run preview    # locally preview the production bundle
```

Before handing off code, also run:

```bash
git diff --check
```

## Recommended change workflow

1. Reproduce or describe the behavior with a focused test.
2. Make the smallest production-code change that satisfies the test.
3. Check nearby state normalization and persistence behavior in `src/store.js`.
4. Run `npm test`.
5. Run `npm run build`.
6. Inspect the final diff for accidental secrets, private addresses, debug
   output, or unrelated formatting changes.

## Feature-specific guidance

### Context windows

The product-approved context presets are:

```text
8K, 16K, 32K, 64K, 128K, 256K
```

The default is 8K. Legacy or manually entered values are normalized to the
nearest approved preset. Update `src/context.js`, the selector in
`src/components/settings-modal.js`, store normalization, and context tests
together; do not add an arbitrary numeric input.

### Model capabilities

Automatic model-name detection is only a convenience. User overrides win.
When adding a capability, update:

- `src/capabilities.js`;
- the relevant input/upload path;
- the Settings UI and persisted overrides;
- component tests.

Never enable a button by default if the configured backend cannot implement its
API.

### API compatibility

`src/api.js` must remain tolerant of optional backend extensions:

- use standard `/models` and `/chat/completions` behavior first;
- support streaming and the non-streaming fallback;
- preserve partial output on stream failure or user cancellation;
- only display performance metrics actually reported by the backend;
- add compatibility tests with realistic response objects.

Do not approximate TTFT, prefill, or decode speed with browser timing when the
backend does not provide those values.

### Device metrics

The health panel's endpoint checks use `GET /v1/models`. Board-level CPU, OS
memory, CMM, network, disk, temperature, and inference information is optional
and comes from a read-only tempmon aggregator configured by the user.

Keep this feature display-only. Lite WebUI must not SSH into a board, execute
commands there, or start/stop model services.

### Documents and multimodal input

File parsing and video sampling happen in the browser. Keep upload limits and
text-extraction settings user-configurable. Large-parser code should remain
lazy-loaded so the initial UI download stays small.

## Deployment model

The production output is the static `dist/` directory. On an AX8860 demo board
it is commonly served by Python's built-in HTTP server; see `README.md` for the
copyable commands and systemd unit.

Agents must not assume that:

- a particular board IP is reachable;
- a model is already running on a fixed port;
- a reverse proxy or HTTPS endpoint exists;
- the board has Node.js installed;
- private monitoring or model-manager credentials are available.

## Debug checklist

Use this order when a user reports a broken chat connection:

1. Confirm the configured endpoint is a server root such as
   `http://<inference-host>:<port>`; a trailing `/v1` is normalized.
2. Confirm `GET /v1/models` works from the same browser machine.
3. Check browser-console CORS errors.
4. Check whether the selected model has the required capability enabled.
5. Inspect the response type and SSE stream in browser developer tools.
6. Re-run the relevant Vitest test with the observed payload.

## Definition of done

A change is ready when:

- focused tests cover the new behavior and relevant regressions;
- `npm test` passes;
- `npm run build` passes;
- the UI remains static and local-first;
- public documentation contains no private address or secret;
- unrelated files and formatting churn are absent.
