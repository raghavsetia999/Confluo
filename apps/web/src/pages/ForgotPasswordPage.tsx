import { ArrowLeft, CheckCircle2, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link } from "react-router"
import AuthLayout from "../components/auth/AuthLayout"
import { authService } from "../services/authService.ts"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")
    try {
      await authService.resetPassword(email)
      setSent(true)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to continue.")
    } finally {
      setLoading(false)
    }
  }
  return (
    <AuthLayout
      title={sent ? "Check your inbox" : "Reset your password"}
      subtitle={
        sent
          ? `We simulated sending a recovery link to ${email}.`
          : "Enter your email and we'll help you get back in."
      }
      footer={
        <Link to="/login">
          <ArrowLeft size={13} />
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="success-state">
          <CheckCircle2 size={32} />
          <p>
            In this local prototype no email was sent. Return to sign in or
            create a new account.
          </p>
          <Link className="primary-button submit-button" to="/login">
            Return to sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoFocus
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button submit-button" disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              "Send recovery link"
            )}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
