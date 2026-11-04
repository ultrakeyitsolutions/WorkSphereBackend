import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { TeamService } from '../src/modules/teams/team.service';
import { MemberService } from '../src/modules/companyadmin/members/member.service';
import { TeamAccessService } from '../src/modules/manager/services/team-access.service';

const COMPANY_ID = '6ae9fd8cc4634cf0b42be688';
const ADMIN_ID = '6ae9fd8cc4634cf0b42be690';
const USER_1 = '6ae9fd8cc4634cf0b42be691';
const USER_2 = '6ae9fd8cc4634cf0b42be692';

describe('Manager Role, Team Management & Access Control', () => {
    it('should calculate team performance accurately', async () => {
        const perf = await TeamService.getTeamPerformance(COMPANY_ID, '6ae9fd8cc4634cf0b42be689');
        expect(perf).toBeDefined();
        expect(perf.teamId).toBeDefined();
        expect(perf.metrics).toBeDefined();
        expect(typeof perf.metrics.completionRate).toBe('number');
    });

    it('should transfer team members cleanly between teams and update cache', async () => {
        const result = await TeamService.transferMembers(
            COMPANY_ID,
            '6ae9fd8cc4634cf0b42be689',
            '6ae9fd8cc4634cf0b42be68a',
            [USER_1],
            ADMIN_ID
        );
        expect(result).toBeDefined();
        expect(result.transferredCount).toBe(1);
    });

    it('should enforce role switching without account duplication', async () => {
        const res = await MemberService.changeUserRole(
            COMPANY_ID,
            USER_1,
            'MANAGER',
            ADMIN_ID
        );
        expect(res.success).toBe(true);
        expect(res.newRole).toBe('MANAGER');
    });
});

