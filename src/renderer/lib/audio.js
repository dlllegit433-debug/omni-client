const SAMPLE_RATE = 16000
const CHUNK_SIZE = 960

export class AudioCall {
  constructor({ ws, peerId, callId }) {
    this.ws = ws
    this.peerId = peerId
    this.callId = callId
    this.active = false
    this.muted = false
    this.sent = 0
    this.recv = 0
    this._context = null
    this._stream = null
    this._processor = null
    this._playQueue = []
    this._playing = false
  }

  async start() {
    try {
      this._context = new AudioContext({ sampleRate: SAMPLE_RATE })
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

      const source = this._context.createMediaStreamSource(this._stream)
      await this._context.audioWorklet.addModule(
        URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }))
      )
      this._processor = new AudioWorkletNode(this._context, 'pcm-processor', {
        processorOptions: { chunkSize: CHUNK_SIZE }
      })

      this._processor.port.onmessage = (e) => {
        if (!this.active || this.muted) return
        const pcm = e.data
        const b64 = _pcmToBase64(pcm)
        this.ws.send({ type: 'call_audio', targetUserId: this.peerId, callId: this.callId, audio: b64 })
        this.sent++
      }

      source.connect(this._processor)
      this._processor.connect(this._context.destination)
      this.active = true
    } catch (err) {
      console.error('[audio] start error:', err)
      throw err
    }
  }

  receive(b64) {
    if (!this.active) return
    try {
      const pcm = _base64ToPcm(b64)
      this._playQueue.push(pcm)
      this.recv++
      if (!this._playing) this._drainQueue()
    } catch {}
  }

  async _drainQueue() {
    if (!this._context || this._playing) return
    this._playing = true
    while (this._playQueue.length > 0) {
      const pcm = this._playQueue.shift()
      await _playPcm(this._context, pcm)
    }
    this._playing = false
  }

  toggleMute() {
    this.muted = !this.muted
    return this.muted
  }

  stop() {
    this.active = false
    this._stream?.getTracks().forEach(t => t.stop())
    this._processor?.disconnect()
    this._context?.close()
    this._context = null
    this._stream = null
    this._processor = null
    this._playQueue = []
    console.log(`[audio] stopped. sent=${this.sent} recv=${this.recv}`)
  }
}

function _pcmToBase64(float32Array) {
  const int16 = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32768))
  }
  const bytes = new Uint8Array(int16.buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function _base64ToPcm(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const int16 = new Int16Array(bytes.buffer)
  const float32 = new Float32Array(int16.length)
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768
  return float32
}

function _playPcm(ctx, float32) {
  return new Promise(resolve => {
    const buf = ctx.createBuffer(1, float32.length, SAMPLE_RATE)
    buf.copyToChannel(float32, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = resolve
    src.start()
  })
}

const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super()
    this._chunkSize = opts.processorOptions.chunkSize || 960
    this._buf = []
  }
  process(inputs) {
    const inp = inputs[0]
    if (inp && inp[0]) {
      this._buf.push(...inp[0])
      while (this._buf.length >= this._chunkSize) {
        const chunk = new Float32Array(this._buf.splice(0, this._chunkSize))
        this.port.postMessage(chunk)
      }
    }
    return true
  }
}
registerProcessor('pcm-processor', PcmProcessor)
`
