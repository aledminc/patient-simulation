# Current repository and runtime

This inventory was prepared before introducing any backend or changing application behavior.

## Files at the repository root

| File | Current role |
|---|---|
| `index.html` | Canonical standalone simulator. It contains the HTML, CSS, JavaScript, four predefined patients, randomized case-generation data, engine selection, conversations, feedback, sharing, import/export, and browser storage. |
| `claude-artifact-version.html` | Separate source version intended to run as a Claude artifact. It is not loaded by `index.html`. |
| `README.md` | Documents static hosting and the current Claude, WebLLM, and scripted modes. |

There was no package manifest, build system, backend, test suite, native executable, model file, or Git metadata in the repository when this benchmark directory was created.

## Current runtime behavior

`python -m http.server 8000` only serves static files. The simulator itself executes in the browser.

For each learner message, `index.html` chooses the first available response engine:

1. Claude, when an Anthropic key exists in `sessionStorage` or `localStorage`. The browser imports the Anthropic SDK from jsDelivr and calls Anthropic directly.
2. WebLLM, after a user loads Llama 3.2 1B or 3B into browser storage. Inference runs through WebGPU in the browser.
3. Scripted JavaScript keyword matching when neither LLM is active.

Conversation turns, demeanor, revealed facts, and feedback are held in page memory and disappear on reload. Saved patients and selected AI settings use browser storage. Google Fonts, jsDelivr modules, and model downloads mean the current application is not a fully bundled offline installation.

The benchmark added beside the application does not import or modify the simulator. It starts its own optional native model processes and writes results only beneath `benchmark/results/` unless another output directory is supplied.

