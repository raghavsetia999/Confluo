import { Link } from "react-router"

export default function Brand({
  compact = false,
  linked = true,
}: {
  compact?: boolean
  linked?: boolean
}) {
  const content = (
    <>
      <span className="brand-mark">
        <i />
        <i />
        <i />
      </span>
      {!compact && <span>Confluo</span>}
    </>
  )
  return linked ? (
    <Link className="brand" to="/">
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  )
}
