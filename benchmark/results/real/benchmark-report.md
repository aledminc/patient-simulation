# CPU feasibility benchmark report

Generated: `2026-11-17T18:45:07.499969+00:00`  
Mode: `real`  
Feasibility-valid measurements: `yes`

## Environment

- OS: Windows-11-10.0.26200-SP0
- Python: 3.12.10 at `C:\Users\alexa\OneDrive\Desktop\ai-patient-simulator\benchmark\.venv\Scripts\python.exe`
- CPU: 12 physical / 14 logical
- RAM: 32281.09 MB

## Cold startup

| Component | Name | Startup |
|---|---|---:|
| llm | qwen3-1.7b-q4_k_m | 1309.09 ms |
| llm | qwen3-4b-q4_k_m | 2655.48 ms |
| stt | whisper-base.en-q5_1 | 535.28 ms |
| stt | whisper-tiny.en-q5_1 | 536.22 ms |
| tts | kokoro-v1.0-int8 | 1408.18 ms |

## Warm component measurements

### LLM: qwen3-1.7b-q4_k_m

- Time to first token: p50 547.87 ms; p95 794.29 ms
- Total generation: p50 1611.52 ms; p95 3023.71 ms
- Hard non-thinking configured: `True`
- Safety: 34/35 responses passed lexical checks
- Unauthorized facts: 0; contradictions: 0; diagnosis leakage: 0; role breaks: 1
- Outside 30-60 token target: 36

### LLM: qwen3-4b-q4_k_m

- Time to first token: p50 1237.66 ms; p95 1311.65 ms
- Total generation: p50 3965.24 ms; p95 5448.05 ms
- Hard non-thinking configured: `True`
- Safety: 35/35 responses passed lexical checks
- Unauthorized facts: 0; contradictions: 0; diagnosis leakage: 0; role breaks: 0
- Outside 30-60 token target: 22

- STT `whisper-base.en-q5_1`: p50 1284.53 ms; p95 1360.60 ms
- STT `whisper-tiny.en-q5_1`: p50 592.49 ms; p95 653.44 ms
- TTS `kokoro-v1.0-int8`: p50 5250.55 ms; p95 6352.48 ms; p95 realtime factor 0.9697163943319396

## Sequential pipeline and stability

- Full pipeline p50: 6308.81 ms
- Full pipeline p95: 7972.00 ms
- Successful runs: 20/20
- Consecutive successful runs from start: 20
- Peak benchmark/model-process RSS: 5694.39 MB
- Peak total-system used memory: 23577.89 MB
- All real model processes resident during warm measurements: `True`

## Feasibility gates

| Gate | Status | Observed | Target |
|---|---|---:|---:|
| medianWarmFullTurn | pass | 6308.81 | < 10000 ms |
| p95TypicalTurn | pass | 7972.00 | < 15000 ms |
| peakApplicationMemory | pass | 5694.39 | < 8192 MB |
| unauthorizedFacts | pass | 0 | 0 |
| twentyConsecutivePipelines | pass | 20 | >= 20 |
| manualQualityReview | fail | Both candidate LLMs produced clinically unauthorized additions or patient-role failures. | approved |

## Unverified real measurements


## Model-quality concerns

- Automatic checks are lexical and require manual review for novel hallucinations, subtle contradictions, and unnatural patient voice.
- The primary LLM produced 26 replies below 30 tokens and 10 overly verbose replies.
- Qwen3 1.7B frequently adopted clinician/assistant language, exposed response-planning language, used third person, or generated malformed and truncated replies.
- Qwen3 4B was more natural but invented symptoms, negative findings, prior medication context, work details, recovery timing, and symptom changes that the controller did not authorize.
- Neither tested model can currently be trusted as a free-form phrasing layer under the zero-unauthorized-facts acceptance criterion.
- The 30-token minimum is poorly matched to brief patient answers and encourages filler; retain a 60-token maximum and evaluate natural minimum length by plan type instead.

## Recommendation

NO-GO for Phase 1 with the tested stack. The following gates did not pass: manualQualityReview.
