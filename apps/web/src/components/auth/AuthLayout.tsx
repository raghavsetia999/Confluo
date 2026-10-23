import type { ReactNode } from "react"
import { Link } from "react-router"
import Brand from "../ui/Brand.tsx"

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="auth-page">
      <nav>
        <Brand />
        <Link to="/">Back to home</Link>
      </nav>
      <section className="auth-card">
        <div className="auth-heading">
          <span className="auth-mark">
            <Brand compact />
          </span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
        <p className="auth-footer">{footer}</p>
        <small className="dev-notice">
          Development-only authentication · Stored locally in this browser
        </small>
      </section>
    </main>
  )
}
