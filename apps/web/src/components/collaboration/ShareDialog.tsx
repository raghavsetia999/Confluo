import { Check, Copy, Link2, UserPlus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { boardService } from "../../services/boardService.ts"
import { uid } from "../../services/persistenceService.ts"
import { useEditorStore } from "../../stores/editorStore.ts"
import Avatar from "../ui/Avatar.tsx"
import Modal from "../ui/Modal.tsx"

export default function ShareDialog({ onClose }: { onClose: () => void }) {
  const { board } = useEditorStore()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"editor" | "viewer">("editor")
  const [message, setMessage] = useState("")
  if (!board) return null
  const invite = (event: FormEvent) => {
    event.preventDefault()
    if (!email.includes("@")) return setMessage("Enter a valid email address.")
    const invitation = {
      id: uid("invite"),
      boardId: board.id,
      email,
      role,
      status: "pending" as const,
    }
    const updated = boardService.update(board.id, {
      invitations: [...board.invitations, invitation],
    })
    useEditorStore.setState({ board: updated })
    setEmail("")
    setMessage(`Invitation simulated for ${invitation.email}.`)
  }
  const copy = async () => {
    await navigator.clipboard?.writeText(window.location.href)
    setMessage("Board link copied. Access remains local to this browser.")
  }
  return (
    <Modal
      title={`Share “${board.title}”`}
      description="Invite collaborators to this locally stored prototype board."
      onClose={onClose}
    >
      <form className="share-form" onSubmit={invite}>
        <div className="input-with-icon">
          <UserPlus size={16} />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
            aria-label="Invite email"
          />
        </div>
        <select
          value={role}
          onChange={(event) =>
            setRole(event.target.value as "editor" | "viewer")
          }
        >
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="primary-button">Invite</button>
      </form>
      {message && (
        <p
          className={
            message.startsWith("Enter") ? "inline-error" : "inline-success"
          }
        >
          <Check size={14} />
          {message}
        </p>
      )}
      <div className="share-link">
        <span>
          <Link2 size={17} />
        </span>
        <div>
          <strong>Board link</strong>
          <small>Only available in this browser prototype</small>
        </div>
        <button className="secondary-button" onClick={copy}>
          <Copy size={14} />
          Copy link
        </button>
      </div>
      <div className="access-list">
        <h3>People and invitations</h3>
        <div className="access-person">
          <Avatar name="Maya Chen" color="coral" status="online" />
          <div>
            <strong>Board owner</strong>
            <small>Owner · Online</small>
          </div>
        </div>
        {board.invitations.map((invitation) => (
          <div className="access-person" key={invitation.id}>
            <Avatar name={invitation.email} color="neutral" status="offline" />
            <div>
              <strong>{invitation.email}</strong>
              <small>{invitation.role} · Invitation pending</small>
            </div>
          </div>
        ))}
      </div>
      <p className="demo-label">
        Demo Collaboration Mode · Invitations are stored locally and no email is
        sent.
      </p>
    </Modal>
  )
}
