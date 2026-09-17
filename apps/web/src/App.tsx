import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, type User } from "./api";
import { CouncilPage } from "./pages/CouncilPage";
import { EventPage } from "./pages/EventPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { NewEventPage } from "./pages/NewEventPage";
import { DevUserSwitcher } from "./components/DevUserSwitcher";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  async function signOut() {
    await api.signout();
    setUser(null);
    navigate("/");
  }

  if (!ready) {
    return (
      <div className="shell">
        <p className="muted">Opening the chamber…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <small>Private dining, public verdict</small>
          <strong>Restaurant Council</strong>
        </Link>
        <div className="nav-row">
          {user ? (
            <>
              <DevUserSwitcher user={user} onAuth={setUser} />
              <Link className="btn secondary" to="/events/new">
                New event
              </Link>
              <button className="btn ghost" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      </header>
      <Routes>
        <Route path="/" element={<HomePage user={user} onAuth={setUser} />} />
        <Route
          path="/events/new"
          element={user ? <NewEventPage /> : <Navigate to="/" replace />}
        />
        <Route
          path="/events/:eventId"
          element={user ? <EventPage user={user} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/events/:eventId/council"
          element={user ? <CouncilPage user={user} /> : <Navigate to="/" replace />}
        />
        <Route path="/join" element={<JoinPage user={user} onAuth={setUser} />} />
      </Routes>
    </div>
  );
}
