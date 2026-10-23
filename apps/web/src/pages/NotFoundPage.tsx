import { ArrowLeft } from "lucide-react"
import { Link } from "react-router"
import Brand from "../components/ui/Brand"

export default function NotFoundPage() {
  return (
    <main className="not-found">
      <Brand />
      <div>
        <span>404</span>
        <h1>This space is still blank.</h1>
        <p>The page may have moved, or the link is no longer available.</p>
        <Link className="primary-button" to="/">
          <ArrowLeft size={15} />
          Return home
        </Link>
      </div>
    </main>
  )
}
