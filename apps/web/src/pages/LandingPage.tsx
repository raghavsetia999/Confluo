import {
  ArrowRight,
  Check,
  Circle,
  Diamond,
  MousePointer2,
  PenLine,
  Play,
  Share2,
  Sparkles,
  Square,
  Users,
} from "lucide-react"
import { Link } from "react-router"
import Brand from "../components/ui/Brand"
import { useAuthStore } from "../stores/authStore.ts"

export default function LandingPage() {
  const user = useAuthStore((state) => state.user)
  return (
    <main className="landing-page">
      <nav className="marketing-nav">
        <Brand />
        <div className="marketing-links">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </div>
        <div className="marketing-actions">
          <Link className="text-button" to={user ? "/dashboard" : "/login"}>
            {user ? "Dashboard" : "Sign in"}
          </Link>
          <Link className="primary-button" to={user ? "/dashboard" : "/signup"}>
            Start creating
            <ArrowRight size={15} />
          </Link>
        </div>
      </nav>
      <section className="hero">
        <div className="hero-pill">
          <Sparkles size={13} />A calmer place for ideas to meet
        </div>
        <h1>
          Think freely.
          <br />
          <span>Create together.</span>
        </h1>
        <p>
          Confluo is the infinite collaborative canvas for turning scattered
          thoughts into shared clarity.
        </p>
        <div className="hero-actions">
          <Link
            className="primary-button large"
            to={user ? "/dashboard" : "/signup"}
          >
            Start creating free
            <ArrowRight size={16} />
          </Link>
          <Link className="secondary-button large" to="/board/demo">
            <Play size={15} fill="currentColor" />
            Explore live demo
          </Link>
        </div>
        <div className="hero-proof">
          <span>
            <Check size={13} />
            No credit card
          </span>
          <span>
            <Check size={13} />
            Works offline
          </span>
          <span>
            <Check size={13} />
            Free to explore
          </span>
        </div>
      </section>
      <section className="product-preview" id="how">
        <div className="preview-top">
          <div>
            <Brand compact />
            <strong>Product discovery</strong>
            <small>Saved locally</small>
          </div>
          <div className="preview-avatars">
            <i>MC</i>
            <i>TL</i>
            <i>NK</i>
            <button>
              <Share2 size={13} />
              Share
            </button>
          </div>
        </div>
        <div className="preview-canvas">
          <div className="preview-title">
            <small>HOW MIGHT WE</small>
            <strong>
              Make onboarding feel
              <br />
              effortless and human?
            </strong>
          </div>
          <div className="preview-stickies">
            <article>Clear first win</article>
            <article>Helpful defaults</article>
            <article>Human welcome</article>
          </div>
          <div className="preview-flow">
            <span>Choose a template</span>
            <ArrowRight />
            <span>Create together</span>
            <ArrowRight />
            <span>Share the outcome</span>
          </div>
          <div className="demo-cursor one">
            <MousePointer2 size={18} fill="currentColor" />
            Theo
          </div>
          <div className="demo-cursor two">
            <MousePointer2 size={18} fill="currentColor" />
            Nora
          </div>
          <div className="preview-toolbar">
            <MousePointer2 />
            <PenLine />
            <Square />
            <Circle />
            <Diamond />
          </div>
        </div>
      </section>
      <section className="feature-section" id="features">
        <div className="section-intro">
          <small>BUILT FOR FLOW</small>
          <h2>
            Everything your team needs.
            <br />
            Nothing it doesn’t.
          </h2>
          <p>
            Powerful collaboration that stays out of your way until you need it.
          </p>
        </div>
        <div className="feature-grid">
          <article>
            <span>
              <PenLine />
            </span>
            <h3>An infinite space to think</h3>
            <p>
              Sketch, diagram, write, and connect ideas without running out of
              room.
            </p>
          </article>
          <article>
            <span>
              <Users />
            </span>
            <h3>Together, in the moment</h3>
            <p>See where teammates are working and build on ideas naturally.</p>
          </article>
          <article>
            <span>
              <Sparkles />
            </span>
            <h3>Every change remembered</h3>
            <p>
              Explore revisions, create checkpoints, and branch without fear.
            </p>
          </article>
        </div>
      </section>
      <footer className="marketing-footer">
        <Brand />
        <p>Calm collaboration for ambitious teams.</p>
        <div>
          <Link to="/login">Sign in</Link>
          <Link to="/signup">Create account</Link>
        </div>
        <small>© 2025 Confluo</small>
      </footer>
    </main>
  )
}
