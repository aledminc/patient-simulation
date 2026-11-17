# Phase 1 verification checklist

## Current decision

**NO-GO pending model-quality remediation and minimum-spec validation.**

The resident stack passed measured latency, memory, startup, and 20-run stability on the development laptop. It did not pass manual review: both Qwen candidates invented unauthorized information or left the patient role. The development laptop is also stronger than the target and the STT fixture was synthesized rather than recorded through a real microphone.

Phase 1 may be implemented as an isolated backend-boundary experiment if the project owner explicitly accepts that it does not approve the later model stack. Under the stated feasibility gates, architectural approval remains a no-go until every item below passes.

## 1. Resolve the phrasing-model quality failure

Engineering must produce a revised controller/phrasing strategy and rerun all 35 plans. Acceptable approaches include:

- Deterministic scripted replies for common response plans.
- Curated response variants selected by the controller.
- A much stronger response plan containing an approved canonical reply, with strict validation and scripted fallback.
- A constrained decoder or semantic validator capable of rejecting invented clinical statements.

Do not approve free-form Qwen output based only on fact-ID validation. The current run demonstrates that both models can invent facts that are not represented by an ID.

Required result:

- [ ] Automatic unauthorized-fact count is zero.
- [ ] Manual review finds zero invented symptoms, history, diagnoses, medicines, negative findings, recovery claims, or treatment advice.
- [ ] No clinician/assistant language, planning language, third-person self-reference, analysis text, or prompt/AI discussion appears.
- [ ] Every rejected generation uses the scripted fallback without changing controller state twice.

## 2. Run on an actual minimum-spec Windows laptop

Use Windows 10 or 11 with approximately four CPU cores/eight threads, 16 GB RAM, and no discrete GPU. Close development tools but keep a normal browser and ordinary background applications open.

Copy the `benchmark/` directory or reproduce the setup from `benchmark/README.md`. Keep the exact model hashes in `results/real/artifact-manifest.json`, or create a new manifest if any artifact changes.

Run:

```powershell
.\benchmark\.venv\Scripts\python.exe .\benchmark\run_benchmark.py `
  --config .\benchmark\config.real.json `
  --preflight-only `
  --output-dir .\benchmark\results\minimum-spec

.\benchmark\.venv\Scripts\python.exe .\benchmark\run_benchmark.py `
  --config .\benchmark\config.real.json `
  --output-dir .\benchmark\results\minimum-spec
```

Required result:

- [ ] Median warm full turn is below 10 seconds.
- [ ] p95 full turn is below 15 seconds.
- [ ] Peak application/model RSS is below 8 GB.
- [ ] Cold startup is below 30 seconds.
- [ ] Twenty consecutive pipelines complete without a crash.
- [ ] Windows remains responsive during inference.

## 3. Replace synthetic STT with real microphone recordings

Record at least 10 push-to-talk utterances through the laptop and microphone intended for the pilot. Include:

- At least three speakers.
- Quiet and realistic classroom/background-noise conditions.
- Short and long questions.
- Patient names, medicine names, numbers, and common clinical vocabulary.
- At least one non-native English accent represented in the expected learner population.

Convert each recording to mono 16 kHz PCM WAV, add it to `config.real.json`, and supply an exact reference transcript.

Required result:

- [ ] Every recording is retained if transcription fails.
- [ ] Transcripts are editable before submission.
- [ ] Faculty considers base.en accuracy adequate for the exercise.
- [ ] Tiny.en is accepted only if its accuracy remains adequate on the same recordings.

## 4. Conduct nursing-faculty response review

Have at least one qualified nursing or medical educator inspect every raw response for both the primary model and scripted fallback. A second reviewer is preferable for disputed items.

Review each response for:

- Factual consistency with the case.
- Correct withholding and disclosure behavior.
- Patient rather than clinician voice.
- Emotional realism.
- Natural, concise wording.
- No diagnosis or treatment invention.
- Appropriate responses to empathy, jargon, repetition, injection attempts, and diagnosis requests.

Record findings in a copy of `manual-review.json` and merge them with:

```powershell
.\benchmark\.venv\Scripts\python.exe .\benchmark\apply_manual_review.py `
  --results .\benchmark\results\minimum-spec\benchmark-results.json `
  --review .\benchmark\results\minimum-spec\manual-review.json `
  --report .\benchmark\results\minimum-spec\benchmark-report.md
```

Required result:

- [ ] Manual quality gate is `pass`.
- [ ] Faculty approves the 1.7B model, or explicitly selects the 4B model with its measured latency tradeoff.

## 5. Conduct voice-quality review

The technical benchmark used one Kokoro voice and neutral synthesis. Create samples for neutral, anxious, irritated, reassured, and pain delivery using the intended wording, punctuation, speed, and volume controls.

Required result:

- [ ] Faculty can reliably distinguish neutral, anxious, irritated, and reassured delivery.
- [ ] Speech remains intelligible at every setting.
- [ ] Audio starts without freezing the interface.
- [ ] The selected voice and nonverbal sounds have acceptable licences and provenance.

## 6. Obtain Windows and organizational approval

Windows Smart App Control blocked the locally compiled llama-server executable on the development machine. The winget-installed llama.cpp runtime was allowed. Before a student pilot:

- [ ] IT approves the executable distribution method.
- [ ] Production binaries are signed or deployed through an approved package channel.
- [ ] Model and voice licences are reviewed for the intended use.
- [ ] Transcript, recording, temporary-audio, and log retention policies are approved.
- [ ] Installation and uninstall behavior is tested on a managed laptop.

## Approval record

Proceed to Phase 1 only after all required boxes above pass.

| Approval | Name | Date | Result |
|---|---|---|---|
| Technical owner |  |  |  |
| Nursing/medical faculty |  |  |  |
| IT/security |  |  |  |
| Privacy/licensing owner |  |  |  |

