export type AcceptInvitationRequest = {
  token: string;
  password: string;
  organizationSlug?: string;
  organizationId?: string;
};

export type AcceptInvitationResponse = {
  user: { id: string; name: string; email: string };
  company: { id: string; name: string; slug: string | null; tenantId: string };
  membership: { roleId: string; designationId: string; status: string };
  accessToken: string;
  refreshToken: string;
  redirectTo: string;
  workspace: string | null;
  tenantSlug: string | null;
};

export type ValidateInvitationResponse = {
  valid: boolean;
  data: {
    invitationId: string;
    organizationId: string;
    organizationSlug: string | null;
    organizationName: string;
    companyName: string;
    email: string | null;
    role: string | null;
    designation: string | null;
    memberType: string;
    status: string;
    expiresAt: string;
    userExists: boolean;
    inviterName: string | null;
    createdAt: string | null;
    organization: {
      id: string;
      name: string;
      slug: string | null;
      tenantId: string | null;
      logoUrl: string | null;
      displayName: string;
      theme: { primaryColor: string; secondaryColor: string; accentColor: string; backgroundColor: string; textColor: string };
      whiteLabelEnabled: boolean;
      invitationBaseUrl: string | null;
    };
  };
};

class ApiError extends Error {
  constructor(public status: number, public body: any, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function json<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    throw new ApiError(res.status, null, `Unexpected response (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function validateInvitation(token: string, organizationSlug?: string): Promise<ValidateInvitationResponse> {
  const qs = new URLSearchParams({ token });
  if (organizationSlug) qs.set('organizationSlug', organizationSlug);
  const res = await fetch(`/api/v1/invitations/validate?${qs}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await json<{ message?: string }>(res).catch(() => ({}));
    throw new ApiError(res.status, body, body?.message || `Validation failed (${res.status})`);
  }
  return json<ValidateInvitationResponse>(res);
}

export async function acceptInvitation(input: AcceptInvitationRequest): Promise<AcceptInvitationResponse> {
  const res = await fetch('/api/v1/invitations/accept', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await json<{ message?: string }>(res).catch(() => ({}));
    throw new ApiError(res.status, body, body?.message || `Acceptance failed (${res.status})`);
  }
  return json<AcceptInvitationResponse>(res);
}

export async function registerViaInvitation(input: {
  token: string;
  name: string;
  password: string;
  organizationSlug?: string;
  organizationId?: string;
}): Promise<AcceptInvitationResponse> {
  const res = await fetch('/api/v1/invitations/register', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await json<{ message?: string }>(res).catch(() => ({}));
    throw new ApiError(res.status, body, body?.message || `Registration failed (${res.status})`);
  }
  return json<AcceptInvitationResponse>(res);
}

export async function deleteMemberApi(
    companyId: string,
    memberId: string,
    deletionMode: 'MEMBER_ONLY' | 'ENTIRE_RECORD',
    confirmation: boolean
): Promise<any> {
    const res = await fetch('/api/v1/company/members/' + memberId, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            deletionMode,
            confirmation,
        }),
    });
    if (!res.ok) {
        const body = await json<{ message?: string }>(res).catch(() => ({}));
        throw new ApiError(res.status, body, body?.message || `Member deletion failed (${res.status})`);
    }
    return json<any>(res);
}

export type BillingPlanDetails = {
    id: string;
    name: string;
    price: number;
    billingCycle: 'MONTHLY' | 'YEARLY' | 'QUARTERLY';
    status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
    currentPeriodStart: string;
    currentPeriodEnd: string;
    maxUsers?: number;
    features?: string[];
};

export type ProratedCreditInfo = {
    amount: number;
    reason: string;
    originalPlanPrice: number;
    newPlanPrice: number;
    creditAppliesTo: string;
    expiresAt: string;
};

export async function fetchBillingInfo(companyId: string): Promise<{
    currentPlan: BillingPlanDetails;
    nextBillingDate: string;
    totalSpentThisPeriod: number;
    proratedCredits: ProratedCreditInfo[];
}> {
    const res = await fetch(`/api/v1/company/billing/${companyId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        const body = await json<{ message?: string }>(res).catch(() => ({}));
        throw new ApiError(res.status, body, body?.message || `Failed to fetch billing info (${res.status})`);
    }
    return json<{
        currentPlan: BillingPlanDetails;
        nextBillingDate: string;
        totalSpentThisPeriod: number;
        proratedCredits: ProratedCreditInfo[];
    }>(res);
}

export async function fetchProratedCreditDetails(companyId: string, creditId: string): Promise<ProratedCreditInfo> {
    const res = await fetch(`/api/v1/company/billing/credit/${creditId}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
        const body = await json<{ message?: string }>(res).catch(() => ({}));
        throw new ApiError(res.status, body, body?.message || `Failed to fetch prorated credit details (${res.status})`);
    }
    return json<ProratedCreditInfo>(res);
}
