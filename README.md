# AXERA Lite WebUI

Lite WebUI is a lightweight, local-first web interface for OpenAI-compatible
models. It is especially useful for trying local or edge-deployed models:
you configure an API endpoint, pick a model, and then chat, inspect files,
generate images, transcribe audio, synthesize speech, and read performance
metrics from one place.

The app runs in the browser. Conversations and settings stay on your device
unless you explicitly export them.

## Demo

<video src="https://github.com/AXERA-TECH/lite_webui/raw/main/assets/lite_webui_sd1.5_ocr_demo.mov" controls width="100%"></video>

If the video does not play inline, [download it here](https://github.com/AXERA-TECH/lite_webui/raw/main/assets/lite_webui_sd1.5_ocr_demo.mov).

## Quick start

Requirements:

- Node.js 18 or newer
- An OpenAI-compatible API

Start the development server:

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Then configure one endpoint:

1. Open **Settings**.
2. Enter the server root URL, for example `http://127.0.0.1:18080`.
   Do **not** append `/v1`.
3. Enter an API key if your server requires one.
4. Click **Fetch Models**.
5. Select a model in the top bar.
6. Start chatting.

For a static production build:

```bash
npm run build
npm run preview
```

The production output is static files. Your model API must allow browser CORS,
be served behind a reverse proxy, or share the same origin as Lite WebUI.

## What can it do?

| Area | What you can do | API used |
|---|---|---|
| Chat | Stream responses, render Markdown/code/math, show reasoning blocks | `POST /v1/chat/completions` |
| Models | Configure several endpoints and switch models | `GET /v1/models` |
| Images | Upload or paste images for vision models | Chat content parts |
| Video | Sample video frames in the browser and send them as images | Chat content parts |
| Documents | Extract text locally from TXT/Markdown/CSV/JSON/PDF/DOCX/XLSX | Chat request after local extraction |
| Image generation | Generate or edit images | `/v1/images/generations`, `/v1/images/edits` |
| Audio input | Upload audio or record from the microphone | `/v1/audio/transcriptions` |
| Speech output | Generate speech; VoxCPM2 PCM can stream while playing | `/v1/audio/speech` |
| Productivity | Search conversations, save prompts, edit and rerun, switch branches | Local browser data |
| Diagnostics | Check endpoint health and AX8860 board state | `/v1/models`, optional metrics API |
| Performance | Show TTFT, prefill, decode, and token counts reported by the backend | Streaming response metadata |

## First-time setup

### 1. API endpoint

Use the server root URL:

```text
http://127.0.0.1:18080
http://127.0.0.1:8000
https://your-api.example.com
```

Do not use:

```text
http://127.0.0.1:18080/v1
```

### 2. Context window

Set **Max Context Tokens** to the real context limit of the selected model.
Lite WebUI uses this value for the `ctx` badge and automatic context resets.

### 3. Model capabilities

After fetching models, enable capabilities per model:

- **Vision** — image and sampled-video input
- **Audio** — audio transcription
- **Draw** — image generation/editing
- **Speak** — text-to-speech

Automatic detection covers common model names, but manual overrides always win.

### 4. Generation defaults

Optional settings include:

```text
System Prompt
Temperature
Top P
Max Output Tokens
Auto-stop on repetition
```

Empty sampling fields are omitted, allowing the backend default to apply.

## Everyday interface guide

| Button or control | Purpose |
|---|---|
| Model picker | Select endpoint and model |
| Activity button | Open Service Health and optional AX8860 device metrics |
| Sparkle button | Open Prompt Library |
| Paperclip button | Attach a document |
| Image button | Attach an image/video, or record audio when the model is audio-capable |
| Draw button | Switch to image generation mode |
| Speak button | Send text for speech synthesis |
| Branch selector | Restore an earlier conversation branch after edit/regeneration |
| `ctx` badge | Show estimated context usage and configured limit |

Keyboard shortcuts:

```text
Enter        send
Shift+Enter  new line
/reset       clear API context but keep visible history
/clean       clear current conversation and API context
```

## Chat and context behavior

- Conversations are stored locally in the browser.
- `/reset` clears the API context while keeping earlier messages visible.
- Switching model or endpoint starts a fresh API context.
- When estimated context usage reaches the configured threshold, Lite WebUI
  resets the API context before the next request.
- Editing a user message creates a reversible branch. Regeneration also saves
  the previous path as a branch.
- The latest 12 branches are retained per conversation.

## Documents, images, and video

### Documents

Supported formats:

```text
TXT / MD / Markdown
CSV / TSV
JSON / JSONL
LOG
XML
YAML / YML
INI / TOML
PDF with selectable text
DOCX
XLSX
```

Processing happens in the browser:

- PDF uses `pdfjs-dist`
- DOCX uses `mammoth`
- XLSX uses `exceljs`
- parser bundles load on demand

The chat shows a compact file card. Extracted text is sent as a normal user
message and included in the context estimate. The original file is not sent to
a third-party service.

Scanned/image-only PDFs need an OCR or Vision model. Legacy `.doc`, `.xls`,
and `.pptx` files are not converted in this release.

### Images

Enable **Vision** for the model, then upload or paste an image. Images are sent
as OpenAI-compatible `image_url` content parts.

### Video

Upload a video when the selected model supports Vision. Lite WebUI samples
evenly spaced frames locally and sends those frames as images. The original
video remains visible in the history; later API calls use the sampled frames.

## Audio and speech

### Transcription

Attach an audio file, or click the microphone to record. Recording is captured
as mono 16 kHz PCM, converted locally to WAV, then uploaded to:

```http
POST /v1/audio/transcriptions
```

If you add an instruction, the transcript and instruction are sent to the
selected chat model afterward.

### Speech generation

Enable **Speak** for a TTS model, then use the Speak button. Non-streaming
backends receive:

```json
{
  "model": "voxcpm2",
  "input": "今天天气很好。",
  "response_format": "wav"
}
```

For VoxCPM2-style backends, enable **Settings → Speech Generation → Stream PCM
audio when available** to request:

```json
{
  "model": "voxcpm2",
  "input": "今天天气很好。",
  "response_format": "pcm",
  "stream": true
}
```

Lite WebUI interprets the stream as little-endian signed 16-bit mono PCM. The
sample rate is read from `X-Sample-Rate` or `Content-Type: audio/pcm;rate=...`;
if absent, it assumes 48 kHz. Audio playback starts while chunks arrive. If PCM
streaming is rejected, the UI automatically retries with WAV.

Generated speech is available for the current page session and is not persisted
as a large base64 blob.

### VoxCPM2 model-name compatibility

The current VoxCPM2 AX8860 server may advertise a GGUF path from `/v1/models`,
while `/v1/audio/speech` expects the service name `voxcpm2`. When the selected
model contains `VoxCPM`, Lite WebUI displays the advertised name but sends
`voxcpm2` to the speech endpoint.

## Service health and AX8860 device metrics

Click the activity button to open **Service Health**.

Lite WebUI checks every configured endpoint using:

```http
GET /v1/models
```

It shows online state, latency, model count, model IDs, and backend/network
errors. **Copy diagnostics** creates a plain-text summary for issue reports.

### Optional board metrics

If you have an AX8860 `tempmon` aggregator, enter its read-only API URL under
**Settings → Device Metrics**:

```text
http://10.126.35.46:8888/api/all
```

The panel can show:

- board agent online/offline state
- llama-server offline/loading/ready/generating state
- model, slot, and context usage
- CMM and OS memory
- NPU temperature and TDP frequency
- network RX/TX
- llama-server process RSS
- 60-second or 5-minute resource trends

Trends include CMM, OS memory, NPU temperature, network, generating slots, and
llama-server RSS. Missing samples break the line instead of being reported as
zero.

This feature is display-only. Lite WebUI does not use SSH, run board commands,
or start/stop models.

## Performance metrics

Lite WebUI can display these metrics under an assistant response:

```text
TTFT
prefill speed
decode speed
input tokens
new prefilled tokens
output tokens
```

Metrics are shown only when the backend reports them. The UI does not replace
them with client-side timing.

Supported sources:

### AXERA extension fields on `usage`

```json
{
  "usage": {
    "prompt_tokens": 4096,
    "prefill_tokens": 12,
    "completion_tokens": 256,
    "ttft_ms": 18,
    "prefill_tps": 3200,
    "decode_tps": 74
  }
}
```

Aliases such as `time_to_first_token_ms`, `prefill_tokens_per_second`, and
`tokens_per_second` are also accepted.

### Native llama.cpp timing fields

```json
{
  "usage": {
    "prompt_tokens": 16,
    "completion_tokens": 16,
    "prompt_tokens_details": { "cached_tokens": 10 }
  },
  "timings": {
    "prompt_ms": 35.496,
    "prompt_per_second": 450.755,
    "predicted_per_second": 129.022
  }
}
```

Here, `prompt_ms` is shown as TTFT, `prompt_per_second` as prefill speed, and
`predicted_per_second` as decode speed.

## API compatibility summary

Lite WebUI targets a practical OpenAI-compatible subset rather than every
optional OpenAI feature.

| Capability | Required endpoint | Notes |
|---|---|---|
| Model list | `GET /v1/models` | Required for model discovery |
| Chat | `POST /v1/chat/completions` | Streaming is preferred; non-streaming JSON fallback is supported |
| Reasoning | SSE `choices[].delta.reasoning_content` | Common backend extension |
| Images | Chat `image_url` parts | Standard Vision-compatible format |
| Video | Multiple image parts | Browser samples frames locally |
| Documents | Chat text message | Browser extracts text locally; no Files API |
| Image generation | `/v1/images/generations` | Optional |
| Image editing | `/v1/images/edits` | Optional multipart |
| Transcription | `/v1/audio/transcriptions` | Optional multipart |
| Speech | `/v1/audio/speech` | Optional; PCM streaming is a VoxCPM2-style extension |
| Performance metrics | `usage` or llama.cpp `timings` | Optional backend extension |

Unknown response fields are ignored, so generic OpenAI-compatible servers can
omit the optional extensions.

## Where is my data stored?

All user data is local to the browser:

```text
settings
endpoints and model selections
model capability overrides
conversations and branches
prompt library
extracted document text
generated images
performance metadata
```

Lite WebUI uses browser `localStorage`. Generated images are stored as data URLs
so they remain visible after a backend restart. Generated speech blobs are not
persisted across page refreshes.

Clearing the browser's site data resets the app.

## Troubleshooting

| Problem | What to check |
|---|---|
| Fetch Models fails | Base URL must not include `/v1`; API must implement `GET /v1/models`; check CORS in production |
| Model list is empty | Click **Fetch Models** and inspect the error in Service Health |
| Image button disabled | Enable **Vision** for the selected model |
| Draw button disabled | Enable **Draw** and confirm image API support |
| Audio button disabled | Enable **Audio** and confirm transcription API support |
| Speak button disabled | Enable **Speak** and confirm speech API support |
| Microphone unavailable | Use localhost or HTTPS, and grant browser permission |
| PCM speech falls back to WAV | Backend rejected PCM streaming; disable streaming to force WAV |
| Requests fail although server is reachable | Backend must support Chat Completions fields and streaming SSE |
| Stream stops with idle timeout | No chunk arrived for 60 seconds; partial output is preserved |
| Transcription works but follow-up fails | Follow-up questions require a chat-capable model |
| Device metrics unavailable | Check aggregator URL, network reachability, and CORS |
| localStorage quota errors | Lower document extraction limit or export/delete old conversations |

## Development

```bash
npm run dev       # development server
npm test          # unit and component tests
npm run build     # production build
npm run preview   # preview production build
```

Before submitting changes, run:

```bash
npm test
npm run build
```

Development mode includes a local CORS proxy. Production deployments need the
model API, a reverse proxy, or same-origin hosting to provide CORS headers.

## License

See the license file in this repository.
