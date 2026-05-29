const WS_URL = 'wss://omnii.duckdns.org:3000/ws?token={token}&version=2.0.0'

export class WSClient {
  constructor({ onMessage, onConnect, onDisconnect }) {
    this.onMessage = onMessage
    this.onConnect = onConnect
    this.onDisconnect = onDisconnect
    this._ws = null
    this._token = null
    this._running = false
    this._reconnectTimer = null
    this._queue = []
    this._reconnectDelay = 3000
  }

  connect(token) {
    this._token = token
    this._running = true
    this._doConnect()
  }

  _doConnect() {
    if (!this._running) return
    const url = WS_URL.replace('{token}', encodeURIComponent(this._token))
    try {
      this._ws = new WebSocket(url)

      this._ws.onopen = () => {
        this._reconnectDelay = 3000
        this._queue.forEach(msg => this._ws.send(JSON.stringify(msg)))
        this._queue = []
        this.onConnect?.()
      }

      this._ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          this.onMessage?.(data)
        } catch {}
      }

      this._ws.onerror = () => {}

      this._ws.onclose = () => {
        this._ws = null
        if (this._running) {
          this.onDisconnect?.()
          this._reconnectTimer = setTimeout(() => {
            this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000)
            this._doConnect()
          }, this._reconnectDelay)
        }
      }
    } catch (err) {
      if (this._running) {
        this._reconnectTimer = setTimeout(() => this._doConnect(), this._reconnectDelay)
      }
    }
  }

  send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data))
    } else {
      this._queue.push(data)
    }
  }

  disconnect() {
    this._running = false
    clearTimeout(this._reconnectTimer)
    this._ws?.close()
    this._ws = null
  }

  get connected() {
    return this._ws?.readyState === WebSocket.OPEN
  }
}
