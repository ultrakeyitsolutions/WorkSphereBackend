import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBillingInfo, fetchProratedCreditDetails, ProratedCreditInfo, BillingPlanDetails } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { DeleteMemberModal } from './DeleteMemberModal';

interface ProratedCreditModalProps {
    isOpen: boolean;
    onClose: () => void;
    credit: ProratedCreditInfo | null;
    companyId: string;
}

export function ProratedCreditModal({
    isOpen,
    onClose,
    credit,
    companyId,
}: ProratedCreditModalProps) {
    if (!credit) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
            <div
                className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto transform overflow-hidden -translate-y-1/2 translate-y-[1/2%] rounded-box border border-gray-200 shadow-xl max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-900">
                        Prorated Credit Details
                    </h3>
                    <button
                        type="button"
                        className="absolute right-2 text-gray-400 hover:text-gray-500"
                        onClick={onClose}
                        aria-label="Close modal"
                    >
                        <svg
                            className="h-5 w-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Credit info */}
                <div className="p-6 space-y-4">
                    <div className="bg-gray-50 rounded-md p-4">
                        <p className="text-sm text-gray-500">Credit Amount</p>
                        <p className="text-3xl font-bold text-primary">{credit.amount > 0 ? `+$${credit.amount}` : `-$${Math.abs(credit.amount)}`}</p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500">Reason</p>
                        <p className="text-medium text-gray-900">{credit.reason}</p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500">Applies To</p>
                        <p className="text-medium text-gray-900">{credit.creditAppliesTo}</p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500">Expires</p>
                        <p className="text-medium text-gray-900">{new Date(credit.expiresAt).toLocaleDateString()}</p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500">Original Plan Price</p>
                        <p className="text-medium text-gray-900">$${credit.originalPlanPrice}</p>
                    </div>

                    <div>
                        <p className="text-sm text-gray-500">New Plan Price</p>
                        <p className="text-medium text-gray-900">$${credit.newPlanPrice}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface MembershipPlanDetailsProps {
    plan: BillingPlanDetails | null;
    loading: boolean;
    error: string | null;
    companyId: string;
    onViewProratedCredit: (creditId: string) => void;
}

export function MembershipPlanDetails({
    plan,
    loading,
    error,
    companyId,
    onViewProratedCredit,
}: MembershipPlanDetailsProps) {
    if (loading) {
        return (
            <div className="p-8 text-center">
                <p>Loading membership plan details...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-8 text-center text-red-500">
                <p>Error loading plan: {error}</p>
            </div>
        );
    }

    if (!plan) {
        return (
            <div className="p-8 text-center text-gray-500">
                <p>No active membership plan found.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Plan Overview */}
            <div className="p-6 bg-gray-50 rounded-lg">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">Current Membership Plan</h2>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm text-gray-500">Plan Name</p>
                        <p className="text-medium text-gray-900">{plan.name}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Billing Cycle</p>
                        <p className="text-medium text-gray-900">{plan.billingCycle}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Monthly Price</p>
                        <p className="text-medium text-gray-900">${plan.price}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Max Users</p>
                        <p className="text-medium text-gray-900">{plan.maxUsers ?? 'Unlimited'}</p>
                    </div>
                </div>

                <p className="text-sm text-gray-500 mt-2">
                    Status: <span className={`font-medium ${plan.status === 'ACTIVE' ? 'text-green-600' : plan.status === 'PAUSED' ? 'text-yellow-600' : 'text-red-600'}`}>{plan.status}</span>
                </p>

                <p className="text-sm text-gray-500 mt-2">
                    Period: {new Date(plan.currentPeriodStart).toLocaleDateString()} - {new Date(plan.currentPeriodEnd).toLocaleDateString()}
                </p>
            </div>

            {/* Prorated Credits Section */}
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Prorated Credits</h2>

                {plan.status === 'ACTIVE' ? (
                    <div className="space-y-3">
                        { /* No credits found or loading */ }
                    </div>
                ) : (
                    <p className="text-sm text-gray-500">No prorated credits available for current plan status.</p>
                )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
                <button
                    onClick={() => window.history.back()}
                    className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                    Back to Dashboard
                </button>
                <button
                    id="view-credits-btn"
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-primary rounded-md hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                    disabled={!plan}
                >
                    View Prorated Credits
                </button>
            </div>
        </div>
    );
}

interface BillingPageProps {
    companyId: string;
}

export function BillingPage({ companyId }: BillingPageProps) {
    const { user } = useAuth();
    const [showProratedCreditModal, setShowProratedCreditModal] = useState(false);
    const [proratedCredit, setProratedCredit] = useState<ProratedCreditInfo | null>(null);

    const { data: billingData, isLoading, error } = useQuery({
        queryKey: ['billing-info', companyId],
        queryFn: () => fetchBillingInfo(companyId),
        enabled: !!user && !!companyId,
    });

    const planDetails = {
        plan: billingData?.currentPlan || null,
        loading: isLoading,
        error: error?.message || null,
        companyId,
        onViewProratedCredit: (creditId: string) => {
            setProratedCredit(null);
            fetchProratedCreditDetails(companyId, creditId).then(
                (credit) => setProratedCredit(credit))
                .catch((err) => console.error('Failed to fetch credit details:', err));
        },
    };

    const membershipPlan = useMemo(
        () => ({
            plan: planDetails.plan,
            loading: planDetails.loading,
            error: planDetails.error,
            companyId,
            onViewProratedCredit: planDetails.onViewProratedCredit,
        }),
        [planDetails]
    );

    const handleOpenProratedCreditModal = useCallback((credit: ProratedCreditInfo) => {
        setProratedCredit(credit);
        setShowProratedCreditModal(true);
    }, []);

    const handleCloseProratedCreditModal = useCallback(() => {
        setShowProratedCreditModal(false);
        setProratedCredit(null);
    }, []);

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <MembershipPlanDetails
                    {...membershipPlan}
                    onViewProratedCredit={handleOpenProratedCreditModal}
                />

                {/* Prorated Credit Modal */}
                <DeleteMemberModal
                    isOpen={showProratedCreditModal}
                    onClose={handleCloseProratedCreditModal}
                    companyId={companyId}
                    memberId=""
                    memberName=""
                    onDeleteConfirmed={(mode, confirmation) => {
                        // Not used for prorated credit modal
                        setShowProratedCreditModal(false);
                    }}
                >
                    <ProratedCreditModal
                        isOpen={showProratedCreditModal}
                        onClose={handleCloseProratedCreditModal}
                        credit={proratedCredit}
                        companyId={companyId}
                    />
                </DeleteMemberModal>
            </div>
        </div>
    );
}