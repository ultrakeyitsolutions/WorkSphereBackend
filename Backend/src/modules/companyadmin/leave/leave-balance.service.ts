import mongoose, { Types } from 'mongoose';
import { EmployeeMonthlyLeaveBalance } from './leave-balance.model';
import { LeaveRequest } from '../../attendance/leave.model';
import { LeaveCalculatorService } from './leave-calculator.service';
import { LeaveType, LeaveStatus } from '../../attendance/attendance.types';
import { ILeaveMonthAllocation } from './leave-policy.types';

export class LeaveBalanceService {
    /**
     * Get or initialize monthly leave balance for an employee.
     */
    static async getOrInitMonthlyBalance(
        companyId: string,
        employeeId: string,
        month: string, // "YYYY-MM"
        leaveType: LeaveType
    ) {
        const cId = new Types.ObjectId(companyId);
        const eId = new Types.ObjectId(employeeId);

        if (mongoose.connection.readyState !== 1) {
            return {
                companyId: cId,
                employeeId: eId,
                month,
                leaveType,
                allocatedPaidDays: 2,
                carriedForwardPaidDays: 0,
                totalEligiblePaidDays: 2,
                requestedDays: 0,
                approvedPaidDays: 0,
                pendingPaidDays: 0,
                unpaidLeaveDays: 0,
                lopDays: 0,
                rejectedCancelledDays: 0,
                remainingPaidBalance: 2,
                availablePaidBalance: 2,
                save: async () => {},
            } as any;
        }

        let balance = await EmployeeMonthlyLeaveBalance.findOne({
            companyId: cId,
            employeeId: eId,
            month,
            leaveType,
        });

        if (!balance) {
            // Resolve active policy allocation
            const policy = await LeaveCalculatorService.resolveActivePolicy(
                companyId,
                leaveType,
                `${month}-01`,
                employeeId
            );

            let carriedForward = 0;
            if (policy.unusedLeavePolicy === 'CARRIES_FORWARD') {
                // Check previous month balance
                const [y, m] = month.split('-').map(Number);
                const prevDate = new Date(Date.UTC(y, m - 2, 1));
                const prevMonthKey = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;

                const prevBalance = await EmployeeMonthlyLeaveBalance.findOne({
                    companyId: cId,
                    employeeId: eId,
                    month: prevMonthKey,
                    leaveType,
                });

                if (prevBalance && prevBalance.remainingPaidBalance > 0) {
                    carriedForward = Math.min(
                        prevBalance.remainingPaidBalance,
                        policy.maxCarryForwardDays || prevBalance.remainingPaidBalance
                    );
                }
            }

            const allocated = policy.monthlyLimit;
            const totalEligible = allocated + carriedForward;

            balance = await EmployeeMonthlyLeaveBalance.create({
                companyId: cId,
                employeeId: eId,
                month,
                leaveType,
                allocatedPaidDays: allocated,
                carriedForwardPaidDays: carriedForward,
                totalEligiblePaidDays: totalEligible,
                requestedDays: 0,
                approvedPaidDays: 0,
                pendingPaidDays: 0,
                unpaidLeaveDays: 0,
                lopDays: 0,
                rejectedCancelledDays: 0,
                remainingPaidBalance: totalEligible,
                availablePaidBalance: totalEligible,
                lastRecalculatedAt: new Date(),
            });
        }

        return balance;
    }

    /**
     * Reserve paid leave days for a pending leave request.
     */
    static async reservePendingBalance(
        companyId: string,
        employeeId: string,
        leaveType: LeaveType,
        monthBreakdown: ILeaveMonthAllocation[]
    ) {
        for (const allocation of monthBreakdown) {
            if (allocation.eligiblePaidDays <= 0) continue;

            const balance = await this.getOrInitMonthlyBalance(
                companyId,
                employeeId,
                allocation.month,
                leaveType
            );

            balance.requestedDays += allocation.totalDays;
            balance.pendingPaidDays += allocation.eligiblePaidDays;
            balance.availablePaidBalance = Math.max(
                0,
                balance.totalEligiblePaidDays - balance.approvedPaidDays - balance.pendingPaidDays
            );
            balance.lastRecalculatedAt = new Date();

            await balance.save();
        }
    }

    /**
     * Release reserved paid leave days when a request is rejected or cancelled.
     */
    static async releasePendingBalance(
        companyId: string,
        employeeId: string,
        leaveType: LeaveType,
        monthBreakdown: ILeaveMonthAllocation[]
    ) {
        for (const allocation of monthBreakdown) {
            const balance = await EmployeeMonthlyLeaveBalance.findOne({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                month: allocation.month,
                leaveType,
            });

            if (balance) {
                balance.pendingPaidDays = Math.max(
                    0,
                    balance.pendingPaidDays - (allocation.eligiblePaidDays || 0)
                );
                balance.rejectedCancelledDays += allocation.totalDays;
                balance.availablePaidBalance = Math.max(
                    0,
                    balance.totalEligiblePaidDays - balance.approvedPaidDays - balance.pendingPaidDays
                );
                balance.lastRecalculatedAt = new Date();

                await balance.save();
            }
        }
    }

    /**
     * Release approved leave days when an approved request is cancelled.
     */
    static async releaseApprovedBalance(
        companyId: string,
        employeeId: string,
        leaveType: LeaveType,
        monthBreakdown: ILeaveMonthAllocation[]
    ) {
        for (const allocation of monthBreakdown) {
            const balance = await EmployeeMonthlyLeaveBalance.findOne({
                companyId: new Types.ObjectId(companyId),
                employeeId: new Types.ObjectId(employeeId),
                month: allocation.month,
                leaveType,
            });

            if (balance) {
                balance.approvedPaidDays = Math.max(
                    0,
                    balance.approvedPaidDays - (allocation.eligiblePaidDays || 0)
                );
                balance.unpaidLeaveDays = Math.max(
                    0,
                    balance.unpaidLeaveDays - (allocation.unpaidDays || 0)
                );
                balance.lopDays = Math.max(
                    0,
                    balance.lopDays - (allocation.proposedLopDays || 0)
                );
                balance.rejectedCancelledDays += allocation.totalDays;
                balance.remainingPaidBalance = Math.max(
                    0,
                    balance.totalEligiblePaidDays - balance.approvedPaidDays
                );
                balance.availablePaidBalance = Math.max(
                    0,
                    balance.totalEligiblePaidDays - balance.approvedPaidDays - balance.pendingPaidDays
                );
                balance.lastRecalculatedAt = new Date();

                await balance.save();
            }
        }
    }

    /**
     * Commit approved leave days to consumed balance.
     */
    static async commitApprovedBalance(
        companyId: string,
        employeeId: string,
        leaveType: LeaveType,
        monthBreakdown: ILeaveMonthAllocation[]
    ) {
        for (const allocation of monthBreakdown) {
            const balance = await this.getOrInitMonthlyBalance(
                companyId,
                employeeId,
                allocation.month,
                leaveType
            );

            // Deduct from pending reservation
            balance.pendingPaidDays = Math.max(
                0,
                balance.pendingPaidDays - (allocation.eligiblePaidDays || 0)
            );
            balance.approvedPaidDays += allocation.eligiblePaidDays;
            balance.unpaidLeaveDays += allocation.unpaidDays || 0;
            balance.lopDays += allocation.proposedLopDays || 0;

            balance.remainingPaidBalance = Math.max(
                0,
                balance.totalEligiblePaidDays - balance.approvedPaidDays
            );
            balance.availablePaidBalance = Math.max(
                0,
                balance.totalEligiblePaidDays - balance.approvedPaidDays - balance.pendingPaidDays
            );
            balance.lastRecalculatedAt = new Date();

            await balance.save();
        }
    }

    /**
     * Recalculates all balances for an employee in a specific month from raw LeaveRequests.
     */
    static async recalculateEmployeeMonthlyBalances(
        companyId: string,
        employeeId: string,
        month: string
    ) {
        const cId = new Types.ObjectId(companyId);
        const eId = new Types.ObjectId(employeeId);

        // Fetch all leave requests touching this month
        const leaves = await LeaveRequest.find({
            companyId: cId,
            employeeId: eId,
            $or: [
                { startDate: { $regex: new RegExp(`^${month}`) } },
                { endDate: { $regex: new RegExp(`^${month}`) } },
                { 'monthBreakdown.month': month },
            ],
        }).lean();

        // Group by leaveType
        const groupedByType: Record<string, any[]> = {};
        for (const l of leaves) {
            if (!groupedByType[l.leaveType]) groupedByType[l.leaveType] = [];
            groupedByType[l.leaveType].push(l);
        }

        const leaveTypes = Object.values(LeaveType);
        for (const lType of leaveTypes) {
            const policy = await LeaveCalculatorService.resolveActivePolicy(
                companyId,
                lType,
                `${month}-01`,
                employeeId
            );

            let requestedDays = 0;
            let approvedPaidDays = 0;
            let pendingPaidDays = 0;
            let unpaidLeaveDays = 0;
            let lopDays = 0;
            let rejectedCancelledDays = 0;

            const relevantLeaves = groupedByType[lType] || [];
            for (const l of relevantLeaves) {
                const allocation = (l.monthBreakdown || []).find((m: any) => m.month === month);
                const monthTotal = allocation ? allocation.totalDays : (l.totalDays || 1);
                const monthPaid = allocation ? allocation.eligiblePaidDays : (l.paidDays || 0);
                const monthLop = allocation ? allocation.proposedLopDays : (l.lopDays || 0);
                const monthUnpaid = allocation ? allocation.unpaidDays : (l.unpaidDays || 0);

                if (l.status === LeaveStatus.PENDING) {
                    requestedDays += monthTotal;
                    pendingPaidDays += monthPaid;
                } else if (l.status === LeaveStatus.APPROVED) {
                    requestedDays += monthTotal;
                    approvedPaidDays += monthPaid;
                    lopDays += monthLop;
                    unpaidLeaveDays += monthUnpaid;
                } else if (l.status === LeaveStatus.REJECTED || l.status === LeaveStatus.CANCELLED) {
                    rejectedCancelledDays += monthTotal;
                }
            }

            const totalEligible = policy.monthlyLimit;
            const remainingPaid = Math.max(0, totalEligible - approvedPaidDays);
            const availablePaid = Math.max(0, remainingPaid - pendingPaidDays);

            await EmployeeMonthlyLeaveBalance.findOneAndUpdate(
                { companyId: cId, employeeId: eId, month, leaveType: lType },
                {
                    $set: {
                        allocatedPaidDays: policy.monthlyLimit,
                        totalEligiblePaidDays: totalEligible,
                        requestedDays,
                        approvedPaidDays,
                        pendingPaidDays,
                        unpaidLeaveDays,
                        lopDays,
                        rejectedCancelledDays,
                        remainingPaidBalance: remainingPaid,
                        availablePaidBalance: availablePaid,
                        lastRecalculatedAt: new Date(),
                    },
                },
                { upsert: true, new: true }
            );
        }
    }

    /**
     * Get monthly leave balances for an employee across all leave types for a year/month.
     */
    static async getEmployeeMonthlyBalances(
        companyId: string,
        employeeId: string,
        query: { month?: string; year?: string }
    ) {
        const cId = new Types.ObjectId(companyId);
        const eId = new Types.ObjectId(employeeId);

        const filter: Record<string, any> = {
            companyId: cId,
            employeeId: eId,
        };

        if (query.month) {
            filter.month = query.month;
        } else if (query.year) {
            filter.month = { $regex: new RegExp(`^${query.year}-`) };
        }

        const balances = await EmployeeMonthlyLeaveBalance.find(filter)
            .sort({ month: -1, leaveType: 1 })
            .lean();

        // If specific month requested and no balances found, initialize them
        if (query.month && balances.length === 0) {
            for (const lType of Object.values(LeaveType)) {
                await this.getOrInitMonthlyBalance(companyId, employeeId, query.month, lType);
            }
            return EmployeeMonthlyLeaveBalance.find(filter)
                .sort({ month: -1, leaveType: 1 })
                .lean();
        }

        return balances;
    }
}
export default LeaveBalanceService;
