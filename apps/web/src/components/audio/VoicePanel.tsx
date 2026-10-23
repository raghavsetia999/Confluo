import { Headphones, Mic, MicOff, Settings2, Volume1, X } from "lucide-react"
import { useState } from "react"
import Avatar from "../ui/Avatar.tsx"

export default function VoicePanel({ close }: { close: () => void }) {
  const [joined, setJoined] = useState(false)
  const [muted, setMuted] = useState(false)
  const [permission, setPermission] = useState<"idle" | "requesting" | "demo">(
    "idle",
  )
  const [settings, setSettings] = useState(false)
  const join = () => {
    setPermission("requesting")
    setTimeout(() => {
      setPermission("demo")
      setJoined(true)
    }, 350)
  }
  return (
    <section className="voice-panel">
      <header>
        <div>
          <span className="voice-live" />
          <div>
            <strong>Spatial audio</strong>
            <small>
              {joined ? "Demo session · 3 nearby" : "Not connected"}
            </small>
          </div>
        </div>
        <button className="icon-button" onClick={close}>
          <X size={16} />
        </button>
      </header>
      {!joined ? (
        <div className="voice-join">
          <Headphones size={27} />
          <h3>Talk where you work</h3>
          <p>
            This demo visualizes spatial audio controls. It does not transmit
            audio.
          </p>
          <button
            className="primary-button"
            onClick={join}
            disabled={permission === "requesting"}
          >
            {permission === "requesting"
              ? "Preparing demo…"
              : "Join demo session"}
          </button>
        </div>
      ) : (
        <>
          <div className="voice-map">
            <div className="proximity-ring one" />
            <div className="proximity-ring two" />
            <span className="voice-you">
              <Avatar name="Maya Chen" color="coral" />
            </span>
            <span className="voice-theo">
              <Avatar name="Theo Lane" color="blue" />
              <i className="speaking" />
            </span>
            <span className="voice-nora">
              <Avatar name="Nora Kim" color="green" />
            </span>
          </div>
          <div className="voice-list">
            <div>
              <Avatar name="Theo Lane" color="blue" />
              <span>
                <strong>Theo</strong>
                <small>Speaking · near</small>
              </span>
              <Volume1 size={15} />
            </div>
            <div>
              <Avatar name="Nora Kim" color="green" />
              <span>
                <strong>Nora</strong>
                <small>Farther away</small>
              </span>
              <Volume1 size={12} />
            </div>
          </div>
          {settings && (
            <div className="audio-settings">
              <label>
                Input
                <select>
                  <option>Demo microphone</option>
                </select>
              </label>
              <label>
                Output
                <select>
                  <option>Default speakers</option>
                </select>
              </label>
            </div>
          )}
          <footer>
            <button
              className={`voice-mute ${muted ? "muted" : ""}`}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              className="icon-button"
              onClick={() => setSettings(!settings)}
            >
              <Settings2 size={17} />
            </button>
            <button className="leave-button" onClick={() => setJoined(false)}>
              Leave
            </button>
          </footer>
        </>
      )}
      <small className="demo-label">
        Demo only · no WebRTC connection or microphone capture
      </small>
    </section>
  )
}
