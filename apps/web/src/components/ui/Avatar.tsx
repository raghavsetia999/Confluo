export default function Avatar({
  name,
  color = "indigo",
  status,
}: {
  name: string
  color?: string
  status?: "online" | "idle" | "offline"
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
  return (
    <span
      className={`avatar avatar-${color}`}
      title={`${name}${status ? ` · ${status}` : ""}`}
    >
      {initials}
      {status && <i className={`presence presence-${status}`} />}
    </span>
  )
}
