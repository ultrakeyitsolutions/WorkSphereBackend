import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { deleteMemberApi } from '../lib/api';
import { useAuth } from '../lib/auth-context';

type DeletionMode = 'MEMBER_ONLY' | 'ENTIRE_RECORD';

interface DeleteMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    companyId: string;
    memberId: string;
    memberName: string;
    memberEmail: string;
    onDeleteConfirmed: (mode: DeletionMode, confirmation: boolean) => void;
}

export function DeleteMemberModal({
    isOpen,
    onClose,
    companyId,
    memberId,
    memberName,
    memberEmail,
    onDeleteConfirmed,
}: DeleteMemberModalProps) {
    const [mode, setMode] = useState<DeletionMode>('MEMBER_ONLY');
    const [showEntireRecordWarning, setShowEntireRecordWarning] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { user } = useAuth();

    const { data, isLoading, error, mutate } = useMutation({
        mutationFn: async (params: {
            deletionMode: DeletionMode;
            confirmation: boolean;
        }) => {
            const result: any = await deleteMemberApi(
                companyId,
                memberId,
                params.deletionMode,
                params.confirmation
            );
            return result;
        },
        onSuccess: (result: any) => {
            // Close modal on success
            onClose();
            // Optionally show success notification
            // Could integrate with toast/success system
        },
        onError: (err: any) => {
            // Keep modal open on error
            console.error('Member deletion failed:', err);
        },
    });

    const handleModeChange = (newMode: DeletionMode) => {
        setMode(newMode);
        // When switching from MEMBER_ONLY to ENTIRE_RECORD, ask for confirmation
        if (newMode === 'ENTIRE_RECORD') {
            setShowEntireRecordWarning(true);
        } else {
            setShowEntireRecordWarning(false);
        }
    };

    const handleCheckboxChange = (checked: boolean) => {
        // Entire record mode is triggered when checkbox is checked
        if (checked) {
            setMode('ENTIRE_RECORD');
        } else {
            setMode('MEMBER_ONLY');
        }
    };

    const handleDeleteConfirm = useCallback(() => {
        const confirmation = mode === 'ENTIRE_RECORD'; // ENTIRE_RECORD requires explicit confirmation
        onDeleteConfirmed(mode, confirmation);
    }, [mode, onDeleteConfirmed]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
            <div
                className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto transform overflow-hidden -translate-y-1/2 translate-y-[1/2%] rounded-box border border-gray-200 shadow-xl max-h-[90vh]"
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-xl font-semibold text-gray-900">
                        Delete Member
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

                {/* Member info */}
                <div className="p-6 space-y-3">
                    <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-500 text-sm font-medium">
                                {memberName?.substring(0, 1) || 'U'}
                            </span>
                        </div>
                        <div>
                            <p className="font-medium text-gray-900">{memberName}</p>
                            <p className="text-sm text-gray-500">{memberEmail}</p>
                        </div>
                    </div>

                    {/* Deletion mode options */}
                    <div className="space-y-3">
                        {/* Option A: Delete Member Only (default) */}
                        <label key="member-only" className="flex items-start space-x-2">
                            <input
                                type="radio"
                                name="deletion-mode"
                                value="MEMBER_ONLY"
                                checked={mode === 'MEMBER_ONLY'}
                                onChange={() => handleModeChange('MEMBER_ONLY')}
                                className="rounded border-gray-300 focus:ring-primary focus:ring-offset-primary"
                            />
                            <div className="flex-1">
                                <p className="font-medium text-gray-900">Delete Member Only</p>
                                <p className="text-xs text-gray-500">
                                    Delete this member's account and personal records while preserving
                                    projects and tasks they created.
                                </p>
                            </div>
                        </div>

                        {/* Option B: Delete Entire Record */}
                        <label key="entire-record" className="flex items-start space-x-2">
                            <input
                                type="checkbox"
                                id="entire-record-checkbox"
                                checked={mode === 'ENTIRE_RECORD'}
                                onChange={(e) => handleCheckboxChange(e.target.checked)}
                                className="rounded border-gray-300 focus:ring-primary focus:ring-offset-primary"
                            />
                            <span
                                className="flex-1 cursor-pointer select-none"
                            >
                                <p className="font-medium text-gray-900">
                                    Also permanently delete all projects, tasks and related records
                                    created by this member
                                </p>
                            </span>
                        </label>

                        {/* Warning when ENTIRE_RECORD mode is selected */}
                        {mode === 'ENTIRE_RECORD' && showEntireRecordWarning && (
                            <div key="warning-box" className="p-3 bg-red-50 border border-red-200 rounded-md mb-3">
                                <p className="text-sm text-red-600">
                                    <strong>Warning:</strong> This will permanently delete projects, tasks,
                                    and related records created by this member that are exclusively owned.
                                    Shared projects and other members' records will be preserved.
                                    This action cannot be undone.
                                </p>
                            </div>
                        )}

                        {/* Explanation when MEMBER_ONLY mode is selected */}
                        {mode === 'MEMBER_ONLY' && (
                            <p key="member-only-desc" className="text-xs text-gray-500">
                                Preserves projects and tasks created by the member. Only the member
                                account and personal records are cleaned up.
                            </p>
                        )}
                    </div>
                </div>

                {/* Buttons */}
                <div className="p-6 border-t border-gray-200">
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-sm font-medium text-gray-200 bg-gray-200 rounded-md hover:bg-gray-300 focus:outline-none focus:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={onClose}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className={`w-full px-4 py-2 text-sm font-medium ${isDeleting ? 'opacity-50 cursor-not-allowed' : 'bg-primary text-white hover:bg-primary-dark'} ${!isOpen ? 'hidden' : ''}`}
                        onClick={() => handleDeleteConfirm()}
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Deleting...' : 'Delete Member'}
                    </button>
                </div>
            </div>
        </div>
    );
}