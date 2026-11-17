# STT fixtures

Real whisper.cpp measurements require one or more learner recordings. Use short, representative utterances of roughly 5-10 seconds. Keep the original recording until transcription has been checked.

The configured whisper.cpp server accepts audio through its `/inference` endpoint. A conservative fixture format is mono, 16 kHz, 16-bit PCM WAV.

Example conversion with FFmpeg:

```powershell
ffmpeg -i .\my-recording.webm -ar 16000 -ac 1 -c:a pcm_s16le .\benchmark\fixtures\question-01.wav
```

Add each file and its exact expected transcript to `config.real.json`. Audio fixtures are intentionally not committed because synthetic speech is not representative of microphone STT performance and real voices may contain personal data.

