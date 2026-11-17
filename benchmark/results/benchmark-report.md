# CPU feasibility benchmark report

Generated: `2026-11-17T17:55:45.504037+00:00`  
Mode: `mock`  
Feasibility-valid measurements: `no`

> Mock mode was used because no candidate binaries or model files were available. All numbers below are actual harness execution measurements, but they are not LLM, STT, or TTS performance results and must not be used for a go/no-go decision.

## Environment

- OS: Windows-11-10.0.26200-SP0
- Python: 3.14.0 at `C:\Users\alexa\AppData\Local\Programs\Python\Python314\python.exe`
- CPU: 12 physical / 14 logical
- RAM: 32281.09 MB

## Cold startup

| Component | Name | Startup |
|---|---|---:|
| llm | mock-qwen3-1.7b-q4 | 0.00 ms |
| stt | mock-whisper-base.en | 0.00 ms |
| tts | mock-kokoro-int8 | 0.00 ms |

## Warm component measurements

### LLM: mock-qwen3-1.7b-q4

- Time to first token: p50 0.01 ms; p95 0.01 ms
- Total generation: p50 0.01 ms; p95 0.01 ms
- Hard non-thinking configured: `not applicable in mock mode`
- Safety: 35/35 responses passed lexical checks
- Unauthorized facts: 0; contradictions: 0; diagnosis leakage: 0; role breaks: 0
- Outside 30-60 token target: 27

- STT `mock-whisper-base.en`: p50 0.00 ms; p95 0.00 ms
- TTS `mock-kokoro-int8`: p50 0.75 ms; p95 0.76 ms; p95 realtime factor 0.002814462674575225

## Sequential pipeline and stability

- Full pipeline p50: 0.80 ms
- Full pipeline p95: 1.06 ms
- Successful runs: 20/20
- Consecutive successful runs from start: 20
- Peak benchmark/model-process RSS: 35.00 MB
- Peak total-system used memory: 17108.84 MB
- All real model processes resident during warm measurements: `False`

## Feasibility gates

| Gate | Status | Observed | Target |
|---|---|---:|---:|
| medianWarmFullTurn | unverified | 0.80 | < 10000 ms |
| p95TypicalTurn | unverified | 1.06 | < 15000 ms |
| peakApplicationMemory | unverified | 35.00 | < 8192 MB |
| unauthorizedFacts | unverified | 0 | 0 |
| twentyConsecutivePipelines | unverified | 20 | >= 20 |

## Unverified real measurements

- Qwen3 1.7B Q4 cold startup, time to first token, warm generation, quality, and resident memory.
- Qwen3 4B Q4 comparison measurements.
- whisper.cpp base.en and tiny.en latency and transcription accuracy on recorded learner speech.
- Quantized Kokoro ONNX cold startup, synthesis latency, realtime factor, and voice quality.
- Full resident-model pipeline p50/p95 latency and twenty-run crash stability.
- Peak application and total-system memory with all candidate models loaded together.

## Model-quality concerns

- No Qwen response was generated, so naturalness, consistency, injection resistance, and diagnosis leakage are unverified.
- The lexical evaluator catches known case-fact markers but cannot prove that a model did not invent a novel clinical claim.
- Twenty-seven fixture replies were below the requested 30-token target; forcing 30 tokens may make simple patient answers unnaturally verbose.
- The raw learner utterance remains visible to the phrasing model as untrusted dialogue, so the 1.7B model's real prompt-injection behavior must be inspected manually.

## Recommendation

NO-GO for Phase 1 approval yet. The harness is ready, but real resident-model latency, memory, stability, and response safety remain unmeasured. Run the real configuration on the minimum-spec laptop before deciding.
