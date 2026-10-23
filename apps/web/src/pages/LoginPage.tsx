import { Eye, EyeOff, LoaderCircle } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link, useLocation, useNavigate } from "react-router"
import AuthLayout from "../components/auth/AuthLayout"
import { useAuthStore } from "../stores/authStore.ts"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [validation, setValidation] = useState("")
  const { login, loading, error, clearError } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    clearError()
    if (!email.includes("@") || password.length < 6)
      return setValidation(
        "Enter a valid email and a password with at least 6 characters.",
      )
    setValidation("")
    try {
      await login(email, password)
      navigate(
        (location.state as { from?: string } | null)?.from ?? "/dashboard",
        { replace: true },
      )
    } catch {
      /* store renders error */
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to your workspace."
      footer={
        <>
          New to Confluo? <Link to="/signup">Create an account</Link>
        </>
      }
    >
      <form className="auth-form" onSubmit={submit}>
        <button
          className="google-button"
          type="button"
          onClick={() =>
            setValidation(
              "Google sign-in requires backend OAuth configuration.",
            )
          }
        >
          <strong>G</strong>Continue with Google
        </button>
        <div className="or-divider">
          <span>or continue with email</span>
        </div>
        <label>
          Email address
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
              placeholder="At least 6 characters"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        <div className="form-row form-row-end">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        {(validation || error) && (
          <p className="form-error">{validation || error}</p>
        )}
        <button className="primary-button submit-button" disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : "Sign in"}
        </button>
      </form>
    </AuthLayout>
  )
}
