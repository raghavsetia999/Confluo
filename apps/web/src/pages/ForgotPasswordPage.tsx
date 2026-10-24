import { ArrowLeft } from "lucide-react"
import { Link } from "react-router"
import AuthLayout from "../components/auth/AuthLayout"

export default function ForgotPasswordPage() {
  return (
    <AuthLayout
      title="Password reset"
      subtitle="Account recovery is not available in this version."
      footer={
        <Link to="/login">
          <ArrowLeft size={13} />
          Back to sign in
        </Link>
      }
    >
      <div className="success-state">
        <p>
          Confluo currently supports password sign-in only. Password reset,
          email verification and multi-factor authentication are not enabled.
          If you cannot sign in, create a new account or contact whoever
          administers this deployment.
        </p>
        <Link className="primary-button submit-button" to="/login">
          Return to sign in
        </Link>
      </div>
    </AuthLayout>
  )
}
