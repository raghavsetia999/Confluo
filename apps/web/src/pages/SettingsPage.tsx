import { ArrowLeft, Check, Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { Link } from "react-router"
import Brand from "../components/ui/Brand"

export default function SettingsPage() {
  const [theme, setTheme] = useState(
    localStorage.getItem("confluo:theme") ?? "light",
  )
  const [grid, setGrid] = useState(true)
  const [snap, setSnap] = useState(true)
  const [cursors, setCursors] = useState(true)
  const [reduced, setReduced] = useState(false)
  const [input, setInput] = useState("default")
  const [output, setOutput] = useState("default")
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const chooseTheme = (value: string) => {
    setTheme(value)
    localStorage.setItem("confluo:theme", value)
  }
  return (
    <main className="settings-page">
      <header>
        <Brand />
        <Link className="secondary-button" to="/dashboard">
          <ArrowLeft size={15} />
          Back to workspace
        </Link>
      </header>
      <div className="settings-shell">
        <aside>
          <h1>Settings</h1>
          <button className="active">Preferences</button>
          <button
            onClick={() => document.getElementById("audio")?.scrollIntoView()}
          >
            Audio
          </button>
          <button
            onClick={() =>
              document.getElementById("accessibility")?.scrollIntoView()
            }
          >
            Accessibility
          </button>
        </aside>
        <section className="settings-content">
          <div>
            <small>APPEARANCE</small>
            <h2>Theme</h2>
            <p>Choose how Confluo looks on this device.</p>
            <div className="theme-options">
              {[
                { id: "light", icon: Sun },
                { id: "dark", icon: Moon },
                { id: "system", icon: Monitor },
              ].map(({ id, icon: Icon }) => (
                <button
                  className={theme === id ? "active" : ""}
                  onClick={() => chooseTheme(id)}
                  key={id}
                >
                  <Icon size={20} />
                  <span>{id[0].toUpperCase() + id.slice(1)}</span>
                  {theme === id && <Check size={15} />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <small>CANVAS</small>
            <h2>Canvas preferences</h2>
            <SettingToggle
              label="Show dot grid"
              description="Display a subtle grid behind your work."
              value={grid}
              setValue={setGrid}
            />
            <SettingToggle
              label="Snap to grid"
              description="Align objects as you move and resize."
              value={snap}
              setValue={setSnap}
            />
            <SettingToggle
              label="Show collaborator cursors"
              description="See where teammates are working."
              value={cursors}
              setValue={setCursors}
            />
          </div>
          <div id="audio">
            <small>AUDIO</small>
            <h2>Voice settings</h2>
            <label>
              Input device
              <select
                value={input}
                onChange={(event) => setInput(event.target.value)}
              >
                <option value="default">Default microphone</option>
                <option value="demo">Demo microphone</option>
              </select>
            </label>
            <label>
              Output device
              <select
                value={output}
                onChange={(event) => setOutput(event.target.value)}
              >
                <option value="default">Default speakers</option>
                <option value="headphones">Headphones</option>
              </select>
            </label>
          </div>
          <div id="accessibility">
            <small>ACCESSIBILITY</small>
            <h2>Motion and focus</h2>
            <SettingToggle
              label="Reduce motion"
              description="Minimize interface transitions and movement."
              value={reduced}
              setValue={setReduced}
            />
            <button
              className="secondary-button"
              onClick={() =>
                alert(
                  "Shortcuts: V Select · H Pan · R Rectangle · O Ellipse · T Text · Delete Remove · ⌘Z Undo",
                )
              }
            >
              View keyboard shortcuts
            </button>
          </div>
        </section>
      </div>
    </main>
  )
}

function SettingToggle({
  label,
  description,
  value,
  setValue,
}: {
  label: string
  description: string
  value: boolean
  setValue: (value: boolean) => void
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        className={`toggle ${value ? "on" : ""}`}
        onClick={() => setValue(!value)}
        aria-pressed={value}
      >
        <i />
      </button>
    </div>
  )
}
