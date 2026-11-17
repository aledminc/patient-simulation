export class PcmRecorder {
  constructor() {
    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.chunks = [];
    this.recording = false;
  }

  async start() {
    if (this.recording) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone recording is unavailable in this browser.");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      this.context = new AudioContext({ latencyHint: "interactive" });
      if (!this.context.audioWorklet) throw new Error("AudioWorklet is unavailable; use typed input instead.");
      await this.context.audioWorklet.addModule(new URL("./pcm-recorder.worklet.js", import.meta.url));
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "pcm-recorder");
      const silent = this.context.createGain();
      silent.gain.value = 0;
      this.node.port.onmessage = event => this.chunks.push(event.data);
      this.source.connect(this.node).connect(silent).connect(this.context.destination);
      this.chunks = [];
      this.recording = true;
    } catch (error) {
      for (const track of this.stream?.getTracks() || []) track.stop();
      await this.context?.close().catch(() => {});
      this.stream = null;
      this.context = null;
      this.source = null;
      this.node = null;
      throw error;
    }
  }

  async stop() {
    if (!this.recording) throw new Error("No recording is active.");
    this.recording = false;
    const sampleRate = this.context.sampleRate;
    this.source?.disconnect();
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() || []) track.stop();
    await this.context?.close();
    const length = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const audio = new Float32Array(length);
    let offset = 0;
    for (const chunk of this.chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.stream = null;
    this.context = null;
    this.source = null;
    this.node = null;
    return { audio, sampleRate, durationSeconds: length / sampleRate };
  }

  async cancel() {
    if (!this.recording) return;
    this.recording = false;
    this.source?.disconnect();
    this.node?.disconnect();
    for (const track of this.stream?.getTracks() || []) track.stop();
    await this.context?.close().catch(() => {});
    this.chunks = [];
    this.stream = null;
    this.context = null;
    this.source = null;
    this.node = null;
  }
}
