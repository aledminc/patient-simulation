# CPU-only Windows feasibility benchmark

This directory benchmarks a proposed local inference stack without importing or changing the browser simulator. It supports:

- Qwen3 GGUF models through persistent `llama-server.exe` processes.
- `whisper.cpp` models through persistent `whisper-server.exe` processes.
- Kokoro ONNX through a persistent Python worker.
- All enabled models loaded at the same time during every warm and pipeline measurement.
- Streaming LLM timing, including time to first content token.
- Process-tree and total-system peak memory sampling.
- p50 and linearly interpolated p95 summaries.
- Deterministic lexical checks across 35 patient response plans.
- Machine-readable JSON and a Markdown report.

The benchmark never downloads models. Model acquisition and licence acceptance are deliberate manual steps.

## Files

| Path | Purpose |
|---|---|
| `run_benchmark.py` | Orchestrator, real and mock adapters, measurements, evaluation, and reports. |
| `kokoro_worker.py` | Keeps the Kokoro model resident between synthesis calls. |
| `qwen3_nonthinking.jinja` | Official Qwen3 hard non-thinking template. The generation prompt inserts an empty `<think>` block. |
| `response_plans.json` | 35 response plans in seven categories plus evaluator-only hidden facts. |
| `config.mock.json` | No-model validation configuration. |
| `config.real.example.json` | Real resident-model configuration template. |
| `CURRENT_REPOSITORY.md` | Repository inventory and pre-benchmark runtime description. |
| `fixtures/` | Location for user-recorded STT fixtures. |
| `results/` | Generated JSON, Markdown, preflight output, and native-process logs. |

## What the quality checks mean

The prompt builder passes Qwen only the controller-approved intent, controller-authorized facts, and facts already disclosed. The raw learner utterance, evaluator-only hidden facts, and diagnoses are not placed in the phrasing-model prompt. Prompt-injection plans therefore test whether the deterministic boundary successfully converts an attack into a safe response plan rather than asking the small model to resist the attack itself.

The automatic evaluator checks generated text for:

- Markers belonging to unauthorized case facts.
- Defined contradiction markers.
- Hidden-diagnosis terms.
- Common AI/simulation role breaks and reasoning markup.
- More than 60 completion tokens or too many sentences.
- Replies below the requested 30-token target.

These are regression checks, not a formal proof. A model can invent a novel clinical statement that is absent from the marker list. Review the generated responses in `benchmark-results.json`, and add markers for every newly observed failure before approving a model.

Manual review is a required feasibility gate. A real run remains `unverified` until a reviewer inspects every raw response and merges a matching review:

```powershell
.\benchmark\.venv\Scripts\python.exe .\benchmark\apply_manual_review.py `
  --results .\benchmark\results\real\benchmark-results.json `
  --review .\benchmark\results\real\manual-review.json `
  --report .\benchmark\results\real\benchmark-report.md
```

## Validate the harness without models

From the repository root:

```powershell
python -m pip install -r .\benchmark\requirements.txt
python .\benchmark\run_benchmark.py `
  --config .\benchmark\config.mock.json `
  --preflight-only `
  --output-dir .\benchmark\results
python .\benchmark\run_benchmark.py `
  --config .\benchmark\config.mock.json `
  --output-dir .\benchmark\results
```

Mock timings measure only Python orchestration and synthetic adapters. Every feasibility gate remains `unverified` in mock mode.

## Prepare a real Windows environment

Use 64-bit Python 3.12 or 3.13. The current `kokoro-onnx` package excludes Python 3.14.

```powershell
py -3.12 -m venv .\benchmark\.venv
.\benchmark\.venv\Scripts\python.exe -m pip install --upgrade pip
.\benchmark\.venv\Scripts\python.exe -m pip install -r .\benchmark\requirements-tts.txt
```

Build or obtain current x64 CPU releases of llama.cpp and whisper.cpp. Example source builds with Visual Studio Build Tools and CMake are:

```powershell
git clone https://github.com/ggml-org/llama.cpp.git .\benchmark\vendor\llama.cpp
cmake -S .\benchmark\vendor\llama.cpp -B .\benchmark\vendor\llama.cpp\build -A x64 -DGGML_NATIVE=ON
cmake --build .\benchmark\vendor\llama.cpp\build --config Release --target llama-server -j 8

git clone https://github.com/ggml-org/whisper.cpp.git .\benchmark\vendor\whisper.cpp
cmake -S .\benchmark\vendor\whisper.cpp -B .\benchmark\vendor\whisper.cpp\build -A x64 -DGGML_NATIVE=ON
cmake --build .\benchmark\vendor\whisper.cpp\build --config Release --target whisper-server -j 8
```

Use a current llama.cpp build with Qwen3 support. The benchmark uses the custom chat template on the server command line; it does not depend on the model obeying `/no_think`.

After obtaining model files with explicit authorization, place them outside the application source or in a deliberately ignored benchmark model directory. The complete comparison configuration expects:

- Qwen3 1.7B Q4 GGUF.
- Qwen3 4B Q4 GGUF.
- whisper.cpp `base.en` quantized model.
- whisper.cpp `tiny.en` quantized model.
- Kokoro v1.0 INT8 ONNX model and matching voices file.

Prepare at least one real 5-10 second microphone recording as described in [fixtures/README.md](fixtures/README.md). One recording can validate plumbing, but several speakers and utterance types are needed for meaningful STT accuracy assessment.

## Configure and run real models

```powershell
Copy-Item .\benchmark\config.real.example.json .\benchmark\config.real.json
notepad .\benchmark\config.real.json
```

Replace every `CHANGE_ME` path. Keep both LLMs and both STT models enabled for the complete comparison. Each server needs a unique port. Then run:

```powershell
.\benchmark\.venv\Scripts\python.exe .\benchmark\run_benchmark.py `
  --config .\benchmark\config.real.json `
  --preflight-only `
  --output-dir .\benchmark\results\real

.\benchmark\.venv\Scripts\python.exe .\benchmark\run_benchmark.py `
  --config .\benchmark\config.real.json `
  --output-dir .\benchmark\results\real
```

Real execution order is deliberate:

1. Start every enabled llama.cpp server, then every whisper.cpp server, then Kokoro.
2. Keep earlier processes resident while later models start.
3. Complete warmups only after every model is resident.
4. Benchmark all 35 plans against every enabled LLM.
5. Benchmark all configured audio fixtures against every enabled STT model.
6. Benchmark Kokoro on ten patient replies.
7. Run 20 sequential STT → response-plan formatting → LLM → TTS pipelines through the primary models.
8. Stop models only after all measurements finish.

If RAM is insufficient to load every comparison candidate together, that is a failed resident-stack observation. Record it before disabling optional candidates and running a reduced deployment stack.

## Outputs

The suite creates:

- `benchmark-results.json`: environment, raw runs, p50/p95 summaries, quality findings, memory peaks, gates, and recommendation.
- `benchmark-report.md`: readable summary.
- `logs/*.log`: llama.cpp and whisper.cpp commands and native output.
- `preflight.json`: path, fixture, template, and response-plan checks.

The full raw outputs are retained in JSON so a questionable response can be tied back to its exact plan and category.

## Feasibility gates

Real mode applies these gates:

| Gate | Requirement |
|---|---:|
| Median warm full sequential turn | Below 10 seconds |
| p95 warm full sequential turn | Below 15 seconds |
| Peak benchmark plus model-process RSS | Below 8 GB |
| Unauthorized fact responses | Zero |
| Consecutive complete pipeline runs | At least 20 |

Total-system used memory is also reported. The 8 GB application gate uses the benchmark process plus all registered model process trees so unrelated desktop applications do not distort that particular gate.

