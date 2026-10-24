import { Check, Copy, Link2, Users } from "lucide-react"
import { useEffect, useState } from "react"
import { boardService } from "../../services/boardService.ts"
import type { Whiteboard } from "../../types/board.ts"
import type { WhiteboardMember } from "../../types/user.ts"
import Avatar from "../ui/Avatar.tsx"
import Modal from "../ui/Modal.tsx"

export default function ShareDialog({
  board,
  onClose,
}: {
  board: Whiteboard
  onClose: () => void
}) {
  const [members, setMembers] = useState<WhiteboardMember[]>(board.members)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    boardService
      .members(board.id)
      .then((next) => {
        if (active) setMembers(next)
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load board members.",
          )
        }
      })
    return () => {
      active = false
    }
  }, [board.id])

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setMessage(`${label} copied`)
      setError("")
    } catch {
      setError("Copy failed. Select the board ID and copy it manually.")
    }
  }

  const link = `${window.location.origin}/board/${board.id}`

  return (
    <Modal
      title={`Share “${board.title}”`}
      description="Share the board ID or link with a signed-in teammate."
      onClose={onClose}
    >
      <div className="share-id-block">
        <span>
          <Link2 size={17} />
        </span>
        <div>
          <strong>Board ID</strong>
          <code>{board.id}</code>
        </div>
        <button
          className="secondary-button"
          onClick={() => void copy(board.id, "Board ID")}
        >
          <Copy size={14} />
          Copy ID
        </button>
      </div>

      <div className="share-link">
        <span>
          <Link2 size={17} />
        </span>
        <div>
          <strong>Board link</strong>
          <small>{link}</small>
        </div>
        <button
          className="secondary-button"
          onClick={() => void copy(link, "Board link")}
        >
          <Copy size={14} />
          Copy link
        </button>
      </div>

      {message && (
        <p className="inline-success">
          <Check size={14} />
          {message}
        </p>
      )}
      {error && <p className="inline-error">{error}</p>}

      <div className="access-list">
        <h3>
          <Users size={13} />
          Members ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="dialog-hint">Loading members…</p>
        ) : (
          members.map((member) => (
            <div className="access-person" key={member.userId}>
              <Avatar
                name={member.name}
                color={member.role === "owner" ? "coral" : "blue"}
                status="offline"
              />
              <div>
                <strong>{member.name}</strong>
                <small>
                  {member.email} · {member.role}
                </small>
              </div>
            </div>
          ))
        )}
      </div>
      <p className="demo-label">
        Board IDs are identifiers, not passwords. Anyone with an account who
        receives this ID can join as an editor. There is no email invitation
        flow yet.
      </p>
    </Modal>
  )
}
