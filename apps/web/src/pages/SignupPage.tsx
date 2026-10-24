import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router"
import AuthLayout from "../components/auth/AuthLayout"
import { useAuthStore } from "../stores/authStore.ts"

export default function SignupPage() {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [validation, setValidation] = useState("")
  const { signup, loading, error, clearError } = useAuthStore()
  const navigate = useNavigate()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    if (name.trim().length < 2) return setValidation("Tell us your name.")
    if (!email.includes("@"))
      return setValidation("Enter a valid email address.")
    if (password.length < 8)
      return setValidation("Password must be at least 8 characters.")
    setValidation("")
    try {
      await signup(name.trim(), email, password)
      navigate("/dashboard")
    } catch {
      /* store renders error */
    }
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="Start bringing your team's ideas together."
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit}>
        <label>
          Your name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Maya Chen"
            autoComplete="name"
          />
        </label>
        <label>
          Work email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />
        </label>
        <label>
          Password
          <div className="password-field">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShow(!show)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <div className="password-hint">
          <span className={password.length >= 8 ? "valid" : ""}>
            <Check size={12} />
            8+ characters
          </span>
          <span className={/[0-9]/.test(password) ? "valid" : ""}>
            <Check size={12} />A number recommended
          </span>
        </div>
        {(validation || error) && (
          <p className="form-error">{validation || error}</p>
        )}
        <button className="primary-button submit-button" disabled={loading}>
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            "Create account"
          )}
        </button>
        <small className="terms">
          By creating an account, you agree to the Terms and Privacy Policy.
        </small>
      </form>
    </AuthLayout>
  )
}
