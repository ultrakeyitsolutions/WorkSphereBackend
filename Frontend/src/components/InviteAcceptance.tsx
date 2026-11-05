import { useState, useEffect, useCallback } from 'react';
import { validateInvitation, acceptInvitation, registerViaInvitation } from '../lib/api';

type View = 'validating' | 'accepting' | 'registered';

export function InviteAcceptance({ initialToken }: { initialToken: string }) {
  const [view, setView] = useState<View>('validating');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>(initialToken);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [data, setData] = useState<any>(null);

  const clearError = useCallback(() => setError(null), []);

  // ── validate the token on mount & when token changes ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setView('validating');
        setError(null);
        const res = await validateInvitation(token);
        if (!res.valid) throw new Error(res.data?.status || 'Invalid invitation');
        setData(res.data);
      } catch (err: any) {
        if (cancelled) return;
        setView('validating');
        setError(err?.message || 'Could not validate this invitation.');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── render helpers ──
  const theme = data?.organization?.theme ?? {
    primaryColor: '#3B82F6',
    secondaryColor: '#1E40AF',
    accentColor: '#6366F1',
    backgroundColor: '#F9FAFB',
    textColor: '#111827',
  };

  const isRegistered = view === 'registered';

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      setView('accepting');
      const res = await acceptInvitation({
        token,
        password,
        organizationSlug: data?.organizationSlug,
      });
      localStorage.setItem('worksphere_access_token', res.accessToken);
      localStorage.setItem('worksphere_refresh_token', res.refreshToken);
      setView('registered');
      setData(res.data || data);
    } catch (err: any) {
      setError(err?.message || 'Unable to accept this invitation. Please try again.');
      setView('accepting');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8 || password !== confirmPassword) {
      setError('Password must be at least 8 characters and match.');
      return;
    }
    try {
      setView('accepting');
      const res = await registerViaInvitation({
        token,
        name,
        password,
        organizationSlug: data?.organizationSlug,
      });
      localStorage.setItem('worksphere_access_token', res.accessToken);
      localStorage.setItem('worksphere_refresh_token', res.refreshToken);
      setView('registered');
      setData(res.data || data);
    } catch (err: any) {
      setError(err?.message || 'Unable to register and accept this invitation.');
      setView('accepting');
    }
  };

  // ── page ──
  return (
    <main className="ws-invite-page" role="main">
      <div className="ws-invite-surface">
        <header className="ws-invite-header">
          {data?.organization?.logoUrl ? (
            <img className="ws-invite-logo" src={data.organization.logoUrl} alt={data.organization.displayName} />
          ) : (
            <div className="ws-invite-logo-placeholder">{data?.organization?.displayName?.[0] ?? 'W'}</div>
          )}
          <h1 className="ws-invite-org-name">{data?.organization?.displayName ?? 'Organization'}</h1>
          <p className="ws-invite-subtitle">{data?.organization?.invitationBaseUrl ?? ''}</p>
        </header>

        <div className="ws-invite-card">
          {error && (
            <div className="ws-invite-alert ws-invite-alert-error" role="alert">
              {error}
              <button type="button" className="ws-invite-alert-close" onClick={clearError} aria-label="Dismiss">{'✕'}</button>
            </div>
          )}

          {view === 'validating' && !error ? (
            <div className="ws-invite-loading">Preparing your invitation…</div>
          ) : data ? (
            <article className="ws-invite-details">
              <h2>Join {data.organizationName}</h2>
              <dl className="ws-invite-meta">
                <dt>Invitation</dt>
                <dd>{data.role ?? 'Member'}</dd>
                <dt>Invited email</dt>
                <dd>{data.email ?? '—'}</dd>
                {data.inviterName && (
                  <>
                    <dt>Invited by</dt>
                    <dd>{data.inviterName}</dd>
                  </>
                )}
                <dt>Expires</dt>
                <dd>{data.expiresAt ?? '—'}</dd>
              </dl>
            </article>
          ) : null}

          {!data || error ? null : (
            <section className="ws-invite-actions">
              <h3>Accept invitation</h3>
              <p>
                You are about to join <strong>{data.organizationName}</strong> as <strong>{data.role ?? 'Member'}</strong>.
                Continue with your existing account or register a new one.
              </p>

              <form className="ws-invite-form" onSubmit={handleAccept} noValidate>
                <div className="ws-invite-field">
                  <label>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={view === 'accepting'}
                    required
                    autoComplete="current-password"
                  />
                </div>
                <button
                  type="submit"
                  className="ws-invite-btn ws-invite-btn-primary"
                  disabled={view === 'accepting'}
                >
                  {view === 'accepting' ? 'Accepting…' : 'Accept invitation & sign in'}
                </button>
              </form>

              <div className="ws-invite-divider">or</div>

              <form className="ws-invite-form" onSubmit={handleRegister} noValidate>
                <div className="ws-invite-field">
                  <label>Full name</label>
                  <input
                    type="text"
                    placeholder="New employee"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={view === 'accepting'}
                    required
                  />
                </div>
                <div className="ws-invite-field">
                  <label>Password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={view === 'accepting'}
                    required
                    minLength="8"
                    autoComplete="new-password"
                  />
                </div>
                <div className="ws-invite-field">
                  <label>Confirm password</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={view === 'accepting'}
                    required
                    minLength="8"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  className="ws-invite-btn ws-invite-btn-outline"
                  disabled={view === 'accepting'}
                >
                  {view === 'accepting' ? 'Creating…' : 'Register & accept'}
                </button>
              </form>

              {data.redirectTo && (
                <p className="ws-invite-note">
                  After acceptance you will be redirected to{' '}
                  <strong>{data.redirectTo}</strong> for workspace <em>{data.workspace ?? data.organizationSlug}</em>.
                </p>
              )}
            </section>
          )}

          {isRegistered && (
            <div className="ws-invite-success">
              <span className="ws-invite-check">✔</span>
              <h3>Welcome to {data?.organizationName ?? 'your organization'}!</h3>
              <p>You can now sign in to your organization dashboard.</p>
              <button
                type="button"
                className="ws-invite-btn ws-invite-btn-primary"
                onClick={() => {
                  const slug = data?.organizationSlug ?? 'app';
                  window.location.href = `${window.location.origin}/login?workspace=${slug}`;
                }}
              >
                Go to dashboard
              </button>
            </div>
          )}
        </div>

        <footer className="ws-invite-footer">
          © {new Date().getFullYear()} {data?.organization?.displayName ?? 'WorkSphere'} · Powered by WorkSphere
        </footer>
      </div>
    </main>
  );
}
