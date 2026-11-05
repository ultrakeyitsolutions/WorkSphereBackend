import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMemberList, deleteMemberApi } from '../lib/api';
import { useAuth } from '../lib/auth-context';

interface MemberRow {
    id: string;
    name: string;
    email: string;
    designation: string;
    role: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    memberType: 'EMPLOYEE' | 'CLIENT' | 'MANAGER';
}

interface KebabMenuItem {
    label: string;
    onClick: (memberId: string, event: React.MouseEvent) => void;
    destructive?: boolean;
}

interface MemberKebabMenuProps {
    member: MemberRow;
    onAction: (memberId: string, action: string) => void;
}

export function MemberKebabMenu({ member, onAction }: MemberKebabMenuProps) {
    const handleDelete = (event: React.MouseEvent) => {
        event.stopPropagation();
        onAction(member.id, 'delete');
    };

    return (
        <div className="relative inline-block">
            <button
                className="flex items-center rounded-md text-sm font-medium hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                aria-label="Open member menu"
                onClick={handleDelete}
            >
                <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                >
                    <path d="M6 10c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V10zm-4 6c0-.9.7-1.6 1.4-1.4L12 14l4-4 1.4-1.4c.7-.7.7-1.6 0-2.3l-2.3-2.3c-.7-.7-1.5-.7-2.2 0L5.4 17.6C4.6 18.9 5 20 6 20z" />
                    <path d="M18 6l-6 6h12l-6-6z" clip-rule="evenodd" />
                </svg>
            </button>

            {/* Menu */}
            <div
                className="absolute right-0 mt-2 w-48 origin-bottom-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-10 hidden"
                role="menu"
                aria-label="Member actions"
            >
                <div class="py-1" role="none">
                    <button
                        className="w-full text-left px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                        onClick={() => onAction(member.id, 'view')}
                        role="menuitem"
                    >
                        View
                    </button>
                    <button
                        className="w-full text-left px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:bg-gray-100"
                        onClick={() => onAction(member.id, 'edit')}
                        role="menuitem"
                    >
                        Edit
                    </button>
                    <button
                        className="w-full text-left px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-red-100 text-red-600 focus:outline-none focus:bg-red-100"
                        onClick={() => onAction(member.id, 'delete')}
                        role="menuitem"
                    >
                        Delete Member
                    </button>
                </div>
            </div>
        </div>
    );
}

interface MembersListProps {
    companyId: string;
}

export function MembersList({ companyId }: MembersListProps) {
    const { user } = useAuth();
    const [members, setMembers] = useState<MemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Fetch members list
    useEffect(() => {
        let cancelled = false;

        const loadMembers = async () => {
            try {
                setLoading(true);
                const result: any = await fetchMemberList(companyId);
                if (!cancelled) {
                    setMembers(result.data || []);
                    setError(null);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err?.message || 'Failed to fetch members');
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadMembers();

        return () => {
            cancelled = true;
        };
    }, [companyId]);

    const handleMemberAction = useCallback(
        async (memberId: string, action: string) => {
            if (action === 'delete') {
                // Open confirmation modal
                // This will be handled by parent component state
                onDeleteRequest?.(memberId);
            }
        },
        [onDeleteRequest]
    );

    return (
        <div className="ws-space-y-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                    Team Members
                </h2>
                <button
                    className="ws-invite-btn ws-invite-btn-primary"
                    onClick={() => /* Add member logic */}
                >
                    Add Member
                </button>
            </div>

            {loading && <p className="text-gray-500">Loading members...</p>}

            {error && (
                <p className="text-red-500 text-sm">{error}</p>
            )}

            {members.length === 0 && (
                <p className="text-gray-500 text-sm">No members found. Add members to your team.</p>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-900">
                    <thead>
                        <tr className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                            <th scope="col" className="py-3 px-6 width-32">Name</th>
                            <th scope="col" className="py-3 px-6 width-48">Email</th>
                            <th scope="col" className="py-3 px-6 width-48">Designation</th>
                            <th scope="col" className="py-3 px-6 width-40">Role</th>
                            <th scope="col" className="py-3 px-6 width-32">Type</th>
                            <th scope="col" className="py-3 px-6 width-40">Status</th>
                            <th scope="col" className="py-3 px-6 width-48">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {members.map((member) => (
                            <tr key={member.id} className="border-b border-gray-200 hover:bg-gray-50">
                                <td className="py-4 px-6">
                                    <div className="flex items-center">
                                        <span className="font-medium">{member.name}</span>
                                    </div>
                                </td>
                                <td className="py-4 px-6">
                                    <div className="text-sm text-gray-600">{member.email}</div>
                                </td>
                                <td className="py-4 px-6">
                                    <div className="text-sm text-gray-600">{member.designation}</div>
                                </td>
                                <td className="py-4 px-6">
                                    <div className="text-sm text-gray-600">{member.role}</div>
                                </td>
                                <td className="py-4 px-6">
                                    <div className="text-sm text-gray-600">
                                        {member.memberType}
                                    </div>
                                </td>
                                <td className="py-4 px-6">
                                    <span
                                        className={`px-2 inline-flex text-xs rounded full-width ${member.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : member.status === 'INACTIVE' ? 'bg-gray-100 text-gray-700' : 'bg-yellow-100 text-yellow-800'}`}
                                    >
                                        {member.status}
                                    </span>
                                </td>
                                <td className="py-4 px-6">
                                    <MemberKebabMenu member={member} onAction={handleMemberAction} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {loading && members.length === 0 && (
                <p className="text-gray-500 text-sm">No members found. Add members to your team.</p>
            )}
        </div>
    );
}