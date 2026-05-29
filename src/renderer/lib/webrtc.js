const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

class WebRTCCallManager {
  constructor() {
    this._pc = null
    this._localStream = null
    this._remoteAudio = null
    this._ws = null
    this._targetUserId = null
    this._callId = null
    this.onStateChange = null
  }

  async startCall(ws, targetUserId, callId) {
    this._cleanup()
    this._ws = ws
    this._targetUserId = targetUserId
    this._callId = callId

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 })
    this._setupPC()

    this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this._localStream.getTracks().forEach(t => this._pc.addTrack(t, this._localStream))

    const offer = await this._pc.createOffer({ offerToReceiveAudio: true })
    await this._pc.setLocalDescription(offer)

    ws.send({
      type: 'call_offer',
      targetUserId,
      callId,
      callType: 'voice',
      offer: { sdp: this._pc.localDescription.sdp, type: this._pc.localDescription.type },
    })
  }

  async answerCall(ws, callerId, callId, offer) {
    this._cleanup()
    this._ws = ws
    this._targetUserId = callerId
    this._callId = callId

    this._pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 10 })
    this._setupPC()

    this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this._localStream.getTracks().forEach(t => this._pc.addTrack(t, this._localStream))

    if (offer?.sdp) {
      await this._pc.setRemoteDescription(new RTCSessionDescription(offer))
    }

    const answer = await this._pc.createAnswer()
    await this._pc.setLocalDescription(answer)

    ws.send({
      type: 'call_answer',
      callerId,
      callId,
      answer: { sdp: this._pc.localDescription.sdp, type: this._pc.localDescription.type },
    })
  }

  async setRemoteAnswer(answer) {
    if (!this._pc || !answer?.sdp) return
    if (this._pc.signalingState === 'stable') return
    try {
      await this._pc.setRemoteDescription(new RTCSessionDescription(answer))
    } catch (e) {
      console.error('[webrtc] setRemoteAnswer:', e)
    }
  }

  async addIceCandidate(candidate) {
    if (this._pc && candidate) {
      try {
        await this._pc.addIceCandidate(new RTCIceCandidate(candidate))
      } catch {}
    }
  }

  toggleMute() {
    if (!this._localStream) return false
    const track = this._localStream.getAudioTracks()[0]
    if (track) {
      track.enabled = !track.enabled
      return !track.enabled
    }
    return false
  }

  get isMuted() {
    const track = this._localStream?.getAudioTracks()[0]
    return track ? !track.enabled : false
  }

  hangup() {
    this._cleanup()
  }

  _cleanup() {
    this._localStream?.getTracks().forEach(t => t.stop())
    this._pc?.close()
    if (this._remoteAudio) {
      this._remoteAudio.srcObject = null
      this._remoteAudio = null
    }
    this._pc = null
    this._localStream = null
    this._ws = null
    this._targetUserId = null
    this._callId = null
  }

  _setupPC() {
    this._pc.onicecandidate = (e) => {
      if (e.candidate && this._ws) {
        this._ws.send({
          type: 'call_ice',
          targetUserId: this._targetUserId,
          callId: this._callId,
          candidate: e.candidate.toJSON(),
        })
      }
    }

    this._pc.onconnectionstatechange = () => {
      const state = this._pc?.connectionState
      console.log('[webrtc] connection state:', state)
      this.onStateChange?.(state)
    }

    this._pc.oniceconnectionstatechange = () => {
      console.log('[webrtc] ICE state:', this._pc?.iceConnectionState)
    }

    this._pc.ontrack = (e) => {
      console.log('[webrtc] remote track received')
      if (!this._remoteAudio) {
        this._remoteAudio = new Audio()
        this._remoteAudio.autoplay = true
      }
      if (e.streams?.[0]) {
        this._remoteAudio.srcObject = e.streams[0]
      }
    }
  }
}

export const callManager = new WebRTCCallManager()
