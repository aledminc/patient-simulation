# AI Patient Simulator

A private, browser-only progressive web app for practicing patient communication. The production application is static: it has no FastAPI process, database, API key, transcript upload, or server-side inference.

The deterministic JavaScript controller owns every patient fact and emotional-state transition. A small WebGPU Qwen3 model may rephrase only facts the controller has already authorized. Whisper and Kokoro run in workers for push-to-talk input and speech output. Every model path has a scripted, typed-input, system-voice, or text-only fallback.

## Local development

Requirements: Node.js 22 or newer and current Chrome or Edge.

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:8000`. Use **Model settings** in the app to download and verify the models recommended for that browser.

`python -m http.server` is not a supported launcher. It does not build the module graph or provide the isolation headers required by multithreaded WebAssembly.

## Verification

```powershell
npm run build
npm test
npm run test:e2e
```

Or run all three with:

```powershell
npm run verify
```

The E2E suite uses the locally installed Chrome and Edge channels, checks compatibility mode, performs a complete typed encounter, tests offline reload, watches for console/network failures, and verifies main-thread responsiveness during worker work.

## Production build

```powershell
npm ci
npm run build
npm run preview
```

Deploy `dist/` to Cloudflare Pages. The required COOP, COEP, CSP, and cache headers are emitted as `dist/_headers`; SPA routing is emitted as `dist/_redirects`.

For a Pages project connected to a GitHub repository, configure:

- Build command: `npm run build`
- Build output directory: `dist`
- Optional environment variable: `VITE_MODEL_BASE_URL=https://your-public-model-origin`

The app can fall back to its pinned public model repositories when the variable is absent, but a controlled R2 mirror is recommended for a production trial. See [Model hosting](docs/MODEL_HOSTING.md) and [Architecture](docs/ARCHITECTURE.md).

## Models

The checked-in integrity manifest pins every file by repository commit, byte size, and SHA-256:

- Whisper tiny.en q8 for speech recognition
- Kokoro 82M v1.1 q8 with `af_maple` for speech synthesis
- Qwen3 0.6B q4f16 WebLLM for optional natural phrasing

Downloads show progress, can be cancelled or retried, are integrity-checked before use, and can be verified, repaired, or removed. Model inference is strictly sequential so STT, LLM, and TTS do not compete for memory.

## Privacy and compatibility

Conversation text and recordings remain in the page. Only aggregate stage timing, failure counts, recovered-error counts, and encounter counts are retained locally. There is no telemetry endpoint.

Without WebGPU, the deterministic scripted patient remains fully usable. Without Whisper, typed input remains enabled. Without Kokoro, the app uses a system voice when possible and otherwise remains text-only. A model crash, timeout, rejected output, or worker error cannot authorize new patient facts.

## Repository map

- `index.html` — existing interface and cases, integrated with the browser runtime
- `src/core/` — deterministic fact and emotional-state authority
- `src/runtime/` — capability tiers, sequential queue, worker lifecycle, diagnostics, fallbacks
- `src/workers/` — isolated model and model-cache work
- `src/models/` — signed manifest access, downloads, verification, repair, removal
- `src/audio/` — push-to-talk AudioWorklet recorder
- `public/` — PWA, service worker, deployment headers, integrity manifest, local ONNX runtime
- `tests/` — controller, cache, lifecycle, fallback, offline, and browser tests
- `benchmark/` — earlier standalone CPU feasibility work; not part of the production runtime
