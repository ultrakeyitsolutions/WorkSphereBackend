import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../lib/tenant';

type View = 'projects' | 'tasks';

interface Team {
    id: string;
    name: string;
    code?: string | null;
    lead?: { id: string; name: string; email: string; avatar?: string | null } | null;
    managers: Array<{ id: string; name: string; email: string; avatar?: string | null }>;
    members: Array<{ id: string; name: string; email: string; avatar?: string | null }>;
    projects: Array<{ id: string; name: string; status?: string; priority?: string }>;
    projectsCount: number;
    membersCount: number;
}

interface ProjectTask {
    id: string;
    title: string;
    taskNumber?: string | null;
    ticketId?: string | null;
    projectName: string;
    status?: { id: string; name: string } | null;
    priority?: string;
    taskType?: string;
    assignedTo?: { id: string; fullName: string; email: string; avatar?: string | null } | null;
    createdBy?: { id: string; fullName: string; email: string; avatar?: string | null } | null;
    dueDate?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    progress?: number;
}

interface EmployeeWorkspaceProps {
    className?: string;
}

export function EmployeeWorkspace({ className }: EmployeeWorkspaceProps) {
    const [view, setView] = useState<View>('projects');
    const [token, setToken] = useState<string | null>(null);
    const [teams, setTeams] = useState<Team[]>([]);
    const [tasks, setTasks] = useState<ProjectTask[]>([]);
    const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const t = params.get('access_token') || params.get('token') || localStorage.getItem('worksphere_token');
        if (t) setToken(t);
    }, []);

    const headers = useCallback(() => {
        const h: Record<string, string> = { Accept: 'application/json' };
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    }, [token]);

    const loadTeams = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/v1/teams`, { headers: headers(), credentials: 'include' });
            if (!res.ok) throw new Error(`Failed to load teams (${res.status})`);
            const json = await res.json();
            const data = json?.data ?? json ?? {};
            const list: Team[] = (data.teams || []).map((t: any) => ({
                id: t.id || t._id,
                name: t.name,
                code: t.code ?? null,
                lead: t.lead ?? null,
                managers: Array.isArray(t.managers) ? t.managers : (t.lead ? [t.lead] : []),
                members: Array.isArray(t.members) ? t.members : [],
                projects: Array.isArray(t.projects) ? t.projects : [],
                projectsCount: t.projectsCount ?? t.projects?.length ?? 0,
                membersCount: t.membersCount ?? t.members?.length ?? 0,
            }));
            setTeams(list);
        } catch (err: any) {
            setError(err?.message || 'Unable to load teams');
        } finally {
            setLoading(false);
        }
    }, [headers]);

    const loadTasks = useCallback(async (projectId: string) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE_URL}/v1/company/projects/${encodeURIComponent(projectId)}/tasks`, {
                headers: headers(),
                credentials: 'include',
            });
            if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`);
            const json = await res.json();
            const data = json?.data ?? json ?? {};
            const rawTasks: any[] = data.tasks ?? data ?? [];
            setTasks(
                rawTasks.map((t: any) => ({
                    id: t.id || t._id,
                    title: t.title,
                    taskNumber: t.taskNumber ?? t.ticketId ?? null,
                    ticketId: t.ticketId ?? null,
                    projectName: t.projectName || '',
                    status: t.status ? { id: t.status?.id ?? t.status?._id ?? '', name: t.status?.name || 'Unknown' } : null,
                    priority: t.priority,
                    taskType: t.taskType,
                    assignedTo: t.assignedTo ?? null,
                    createdBy: t.createdBy ?? null,
                    dueDate: t.dueDate ?? null,
                    startDate: t.startDate ?? null,
                    endDate: t.endDate ?? null,
                    progress: t.progress ?? 0,
                }))
            );
        } catch (err: any) {
            setError(err?.message || 'Unable to load tasks');
        } finally {
            setLoading(false);
        }
    }, [headers]);

    useEffect(() => {
        loadTeams();
    }, [loadTeams]);

    const projectForTeam = (team: Team) => team.projects;

    const allProjects = teams.flatMap((team) =>
        projectForTeam(team).map((p) => ({ ...p, teamId: team.id, teamName: team.name, manager: team.managers[0] ?? team.lead ?? null }))
    );

    const statusColor = (status?: string | null) => {
        const s = (status || '').toLowerCase();
        if (s.includes('completed') || s.includes('done') || s.includes('closed')) return '#16a34a';
        if (s.includes('in progress') || s.includes('active') || s.includes('working')) return '#2563eb';
        if (s.includes('hold') || s.includes('paused') || s.includes('blocked')) return '#d97706';
        if (s.includes('cancelled')) return '#6b7280';
        return '#64748b';
    };

    const priorityColor = (priority?: string | null) => {
        const p = (priority || '').toUpperCase();
        if (p === 'URGENT') return '#dc2626';
        if (p === 'HIGH') return '#ea580c';
        if (p === 'MEDIUM') return '#d97706';
        if (p === 'LOW') return '#16a34a';
        return '#64748b';
    };

    const baseStyle: React.CSSProperties = {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: '#111827',
        minHeight: '100vh',
        background: '#f9fafb',
    };

    const containerStyle: React.CSSProperties = { maxWidth: 1100, margin: '0 auto', padding: 24 };

    const headerStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #e5e7eb',
    };

    const badgeStyle = (color: string): React.CSSProperties => ({
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px',
        borderRadius: 9999, fontSize: '11.5px', fontWeight: 600,
        color: '#ffffff', background: color,
    });

    const cardStyle: React.CSSProperties = {
        background: '#ffffff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 12,
        cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s',
    };

    const emptyStyle: React.CSSProperties = {
        textAlign: 'center', padding: 60, color: '#6b7280',
    };

    if (view === 'tasks' && selectedProject) {
        return (
            <div style={baseStyle} className={className}>
                <div style={containerStyle}>
                    <div style={headerStyle}>
                        <button
                            onClick={() => { setView('projects'); setSelectedProject(null); setTasks([]); setError(null); }}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: '1px solid #e5e7eb', color: '#2563eb', padding: '6px 12px', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
                        >
                            ← Back to projects
                        </button>
                        <div style={{ marginLeft: 12 }}>
                            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{selectedProject.name}</h1>
                            <p style={{ margin: 4, fontSize: 14, color: '#6b7280' }}>Tasks · {selectedProject.name}</p>
                        </div>
                    </div>

                    {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}
                    {loading ? (
                        <p style={emptyStyle}>Loading tasks…</p>
                    ) : tasks.length === 0 ? (
                        <p style={emptyStyle}>No tasks found for this project.</p>
                    ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                            {tasks.map((t) => {
                                const statusName = t.status?.name || 'Unknown';
                                const assigneeName = t.assignedTo?.fullName || t.assignedTo?.email || 'Unassigned';
                                const creatorName = t.createdBy?.fullName || t.createdBy?.email || 'Unknown';
                                return (
                                    <div key={t.id} style={{ ...cardStyle, borderLeft: `4px solid ${statusColor(t.status?.name)}` }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                                                    <span style={{ fontWeight: 700, fontSize: 15 }}>{t.title}</span>
                                                    {t.taskNumber && <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{t.taskNumber}</span>}
                                                    {t.ticketId && <span style={{ fontSize: 12, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>{t.ticketId}</span>}
                                                </div>
                                                <div style={{ display: 'flex', gap: 10, fontSize: 12.5, color: '#4b5563', marginBottom: 6 }}>
                                                    <span style={{ ...badgeStyle(statusColor(statusName)) }}>{statusName}</span>
                                                    <span style={{ ...badgeStyle(priorityColor(t.priority)) }}>{t.priority || '—'}</span>
                                                    <span>{t.taskType || 'Task'}</span>
                                                    <span>{t.progress != null ? `${t.progress}%` : '—'}</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#374151' }}>
                                                    <span>Assignee: <b>{assigneeName}</b></span>
                                                    <span>Created by: <b>{creatorName}</b></span>
                                                    {t.dueDate && <span>Due: <b>{new Date(t.dueDate).toLocaleDateString()}</b></span>}
                                                </div>
                                            </div>
                                            <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
                                                {t.projectName && <div style={{ marginBottom: 4 }}>{t.projectName}</div>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Projects view
    return (
        <div style={baseStyle} className={className}>
            <div style={containerStyle}>
                <div style={headerStyle}>
                    <div>
                        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Employee Workspace</h1>
                        <p style={{ margin: 6, fontSize: 14.5, color: '#6b7280' }}>
                            Projects assigned to your teams. Tap a project to open its Tasks page.
                        </p>
                    </div>
                    {!token && (
                        <div style={{ fontSize: 12.5, color: '#dc2626', background: '#fef2f2', padding: '6px 10px', borderRadius: 6, border: '1px solid #fecaca' }}>
                            Not authenticated — add ?access_token=… to load data
                        </div>
                    )}
                </div>

                {error && <p style={{ color: '#dc2626', marginBottom: 12 }}>{error}</p>}

                {loading ? (
                    <p style={emptyStyle}>Loading your teams and projects…</p>
                ) : allProjects.length === 0 ? (
                    <p style={emptyStyle}>No team-assigned projects found.</p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                        {allProjects.map((p) => {
                            const managerName = p.manager?.name || 'No manager assigned';
                            return (
                                <div
                                    key={p.id}
                                    style={cardStyle}
                                    onClick={() => { setSelectedProject({ id: p.id, name: p.name }); loadTasks(p.id); setView('tasks'); }}
                                >
                                    <div style={{ marginBottom: 10 }}>
                                        <span style={{ ...badgeStyle('#2563eb'), marginRight: 6 }}>{p.teamName}</span>
                                        <span style={{ fontSize: 11.5, color: '#6b7280', background: '#f3f4f6', padding: '1px 6px', borderRadius: 4 }}>Team</span>
                                    </div>
                                    <h3 style={{ margin: '0 0 8 0', fontSize: 16, fontWeight: 700, color: '#111827' }}>{p.name}</h3>
                                    <div style={{ display: 'flex', gap: 10, fontSize: 12.5, color: '#4b5563', marginBottom: 8 }}>
                                        <span style={{ ...badgeStyle(priorityColor(p.priority)) }}>{p.priority || '—'}</span>
                                        <span style={{ ...badgeStyle(statusColor(p.status)) }}>{p.status || '—'}</span>
                                    </div>
                                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 10 }}>
                                        <span>Manager: <b>{managerName}</b></span>
                                    </div>
                                    <div style={{ fontSize: 12, color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                                        View project tasks →
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
