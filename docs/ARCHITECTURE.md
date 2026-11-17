# Browser MVP architecture

## Trust boundary

The deterministic patient controller is the only medical-truth authority. For each learner turn it:

1. classifies safety, diagnosis, empathy, jargon, repetition, and fact-key matches;
2. advances immutable demeanor and reveal state;
3. authorizes zero, one, or two fact IDs;
4. creates a scripted response;
5. optionally creates a public phrasing plan containing only the spoken form of authorized facts.

The learner's raw message, hidden case definition, unrevealed facts, diagnosis, and full transcript are not sent to Qwen. Generated text is checked for role-breaking, length, loss of approved content, and overlap with unauthorized facts. Rejected output is replaced by the already-approved scripted response. The controller's fact IDs remain authoritative regardless of generated wording.

## Runtime flow

```text
push-to-talk audio -> Whisper worker -> editable transcript
                                         |
typed/editable text -> deterministic controller -> scripted fast path
                                         |
                              approved phrasing plan only
                                         |
                                  Qwen WebGPU worker
                                         |
                                  output validation
                                         |
                              Kokoro worker -> audio
```

The shared inference queue allows only one STT, LLM, or TTS operation at a time and limits pending work. Worker requests have timeouts, cancellation, restart, and structured failure codes. Model failure never rolls back or expands controller authorization.

## Capability tiers

- **Full on-device:** WebGPU, workers, WebAssembly, persistent cache, sufficient reported memory/storage; all three models recommended.
- **Balanced:** capable WebGPU device with tighter memory; STT and LLM recommended, system speech available as TTS fallback.
- **WASM voice:** no WebGPU; Whisper and Kokoro recommended, scripted patient phrasing.
- **Storage limited:** model installation is not recommended; scripted typed encounter remains available.
- **Compatibility:** a required browser primitive is unavailable; scripted typed encounter remains available.

Capability detection is advisory. Every feature checks its model and primitive again at use time.

## Persistence and offline behavior

The service worker precaches the production app and local inference runtime assets. The model manager streams pinned assets into a dedicated Cache API cache, verifies byte length and SHA-256, and deletes partial or corrupt entries. Model metadata stores no conversation content. Offline requests for pinned model URLs are resolved from the verified cache.

Changing the model manifest version invalidates readiness metadata. Users can re-inventory, repair, or remove each model from the settings panel.

## Privacy

No backend or telemetry transport exists in the production bundle. Raw audio is retained only in memory long enough to allow transcription retry. Conversation and feedback state are page-local. Aggregate diagnostics contain only counts and millisecond timings.

## Deployment boundary

Cloudflare Pages serves the static app with cross-origin isolation headers. Cloudflare R2, or another CORS-enabled immutable origin, serves versioned model bytes. The GitHub repository can be the Pages source, but GitHub Pages itself cannot supply the required response-header configuration.
