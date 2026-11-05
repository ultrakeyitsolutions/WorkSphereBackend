import { useState, useEffect, useMemo } from 'react';
import { resolveTenant, extractOrganizationSlug, DEFAULT_TENANT } from './lib/tenant';
import { InviteAcceptance } from './components/InviteAcceptance';
import { MembersList } from './components/MembersList';
import { DeleteMemberModal } from './components/DeleteMemberModal';
import { EmployeeWorkspace } from './components/EmployeeWorkspace';
import { BillingPage } from './components/BillingPage';

export function App() {
  const [tenant, setTenant] = useState(DEFAULT_TENANT);
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [memberIdForDelete, setMemberIdForDelete] = useState<string | null>(null);
  const [deletionMode, setDeletionMode] = useState<'MEMBER_ONLY' | 'ENTIRE_RECORD'>('MEMBER_ONLY');
  const [deletionConfirmation, setDeletionConfirmation] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      const adminMode = params.get('admin') === 'true';
      setToken(t ?? null);

      if (t) {
        const resolved = await resolveTenant();
        setTenant(resolved);
        setReady(true);
        return;
      }

      // Non-invite pages resolve branding from hostname but do not auto-redirect.
      const resolved = await resolveTenant();
      setTenant(resolved);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  if (!ready) return null;

  // Invitation acceptance page — rendered once per shared frontend app.
  if (token) {
    return <InviteAcceptance initialToken={token} />;
  }

  // Employee Workspace — team-assigned projects with Team badge + Manager name,
  // click-through to the project Tasks page. Opt-in via ?workspace=employee.
  if (params.get('workspace') === 'employee') {
    return <EmployeeWorkspace />;
  }

  // Company Admin Members Dashboard — rendered when no token and admin mode
  if (!token && showDeleteModal === false) {
    return (
<main style={{ minHeight: '100vh', background: tenant.theme.backgroundColor, color: tenant.theme.textColor }}>
          <header style={{ padding: '24px 40px', background: tenant.theme.secondaryColor, color: '#fff' }}>
            {tenant.logoUrl ? (
              <img src={tenant.logoUrl} alt={tenant.displayName} style={{ height: '40px', display: 'block' }} />
            ) : (
              <div style={{ fontWeight: 'bold', fontSize: '20px' }}>{tenant.displayName}</div>
            )}
          </header>
          <section style={{ padding: '40px', maxWidth: '720px', margin: '0 auto' }}>
            <h1>WorkSphere Admin</h1>
            <p>Company Administration Panel</p>
            <MembersList companyId={tenant.slug ?? 'company-a'} />
            {tenant.suspended && (
              <p style={{ color: '#b91c1c' }}>
                This workspace is currently suspended. Please contact your administrator.
              </p>
            )}
            <BillingPage companyId={tenant.slug ?? 'company-a'} />
          </section>
        </main>
    );
  }

  // Delete Member Modal
  if (showDeleteModal && memberIdForDelete) {
    return (
      <DeleteMemberModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        companyId={memberIdForDelete || 'company-a'}
        memberId={memberIdForDelete || ''}
        memberName={/* would come from state */}
        onDeleteConfirmed={(mode, confirmation) => {
          // Call the delete API
          // This is a simplified integration - actual API call uses mutate from react-query
          setShowDeleteModal(false);
        }}
      />
    );
  }

  // Fallback landing shell
  return (
    <main style={{ minHeight: '100vh', background: tenant.theme.backgroundColor, color: tenant.theme.textColor }}>
      <header style={{ padding: '24px 40px', background: tenant.theme.secondaryColor, color: '#fff' }}>
        {tenant.logoUrl ? (
          <img src={tenant.logoUrl} alt={tenant.displayName} style={{ height: '40px', display: 'block' }} />
        ) : (
          <div style={{ fontWeight: 'bold', fontSize: '20px' }}>{tenant.displayName}</div>
        )}
      </header>
      <section style={{ padding: '40px', maxWidth: '720px', margin: '0 auto' }}>
        <h1>Welcome to {tenant.displayName}</h1>
        <p>
          This is the shared WorkSphere frontend. Organization-specific invitations
          arrive at URLs such as{' '}
          <code>{`https://${tenant.slug ?? 'company-a'}.uworksphere.com/invite?token=...`}</code>.
        </p>
        {tenant.suspended && (
          <p style={{ color: '#b91c1c' }}>
            This workspace is currently suspended. Please contact your administrator.
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
