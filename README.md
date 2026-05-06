# AXERA Lite WebUI

A lightweight, local-first chat UI for OpenAI-compatible APIs.

It runs entirely in the browser, supports streaming responses, and stores conversations locally.

## Features

- OpenAI-compatible chat interface
- Streaming responses
- Markdown rendering with code highlighting
- Local conversation history in the browser
- Image upload and paste for vision-capable models
- Audio transcription workflow for compatible APIs
- Configurable context window and auto-reset threshold
- Light and dark themes

## Requirements

- Node.js 18+
- An OpenAI-compatible API that supports:
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Optional audio support:
  - `POST /v1/audio/transcriptions`

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## First-Time Setup

1. Open **Settings**.
2. Enter your **API Base URL**.
3. Enter your **API Key** if your provider requires one.
4. Set **Max Context Tokens** to the real limit of your model.
5. Adjust **Auto-reset Threshold (%)** if needed.
6. Click **Save Settings**.
7. Click **Fetch Models**.
8. Select a model from the top bar.

![Settings screen](assets/settings.png)

### API Base URL

Use the server root URL. Do **not** append `/v1`.

Correct:

```text
http://127.0.0.1:8000
http://127.0.0.1:11434
https://your-api.example.com
```

Incorrect:

```text
http://127.0.0.1:8000/v1
http://127.0.0.1:11434/v1
```

## Usage

- **Send:** `Enter`
- **New line:** `Shift+Enter`
- **Reset API context only:** `/reset`
- **Clear current conversation and API context:** `/clean`

### Images

- Upload an image with the image button, or paste an image into the input box.
- The current model must have **Vision** enabled.

### Audio

- Attach an audio file from the input bar.
- The current model must have **Audio** enabled.
- Your API must support `POST /v1/audio/transcriptions`.

### Context Badge

The `ctx x/y` badge in the input bar shows:

- current estimated context usage
- configured context window limit

When usage approaches the configured threshold, the app automatically resets API context before the next send.

## Development and Deployment

### Development

```bash
npm run dev
```

Development mode includes a built-in proxy, which is useful when your API does not allow browser CORS requests during local development.

### Production Preview

```bash
npm run build
npm run preview
```

The production build is static. Your API must allow browser access directly, be served behind a reverse proxy, or share the same origin as the frontend.

## Commands

```bash
npm run dev
npm run build
npm run preview
npm test
```

## Data Storage

Settings, model capability overrides, theme preference, and conversations are stored in your browser with `localStorage`.

Clearing site storage resets the app.

## Troubleshooting

### Fetch Models fails

- Make sure you clicked **Save Settings** first.
- Make sure **API Base URL** does not include `/v1`.
- Confirm your API supports `GET /v1/models`.
- If it works in `npm run dev` but fails in preview or production, check CORS.

### Model list is empty

- Click **Fetch Models**.
- Verify the request succeeded.
- Confirm your API returns models from `GET /v1/models`.

### Image button is disabled

- Enable **Vision** for the selected model in **Settings**.

### Audio button is disabled

- Enable **Audio** for the selected model in **Settings**.
- Confirm your backend supports audio transcription.

### Requests fail even though the server is reachable

Make sure your backend is compatible with the OpenAI Chat Completions format, especially `model`, `messages`, and streaming responses.
