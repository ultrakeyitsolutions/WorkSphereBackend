import { Types } from 'mongoose';
import { getMailTransporter, mailDefaults } from '../../../config/mail';
import { env } from '../../../config/env';
import { LeaveRequest } from '../../attendance/leave.model';
import { LopDecision } from './lop-decision.model';
import { User } from '../../users/user.model';
import { Company } from '../../super-admin/companies/company.model';

export class LeaveEmailService {
    /**
     * Sends an email notification to the employee when their leave request is approved.
     * Includes duration and paid/unpaid/LOP breakdown.
     */
    static async sendLeaveApprovalEmail(leaveRequestId: string): Promise<boolean> {
        try {
            const leave = await LeaveRequest.findById(leaveRequestId)
                .populate('employeeId', 'name email')
                .populate('approvedBy', 'name email')
                .populate('companyId', 'name')
                .lean();

            if (!leave || leave.status !== 'APPROVED') {
                return false;
            }

            // Prevent duplicate emails
            if ((leave as any).emailDeliveryStatus === 'SENT') {
                return true;
            }

            const employee = leave.employeeId as any;
            if (!employee || !employee.email) {
                return false;
            }

            const approver = leave.approvedBy as any;
            const company = leave.companyId as any;

            const appUrl = env.APP_URL || 'http://localhost:3000';
            const actionUrl = `${appUrl}/main/attendance?tab=leaves&leaveId=${leave._id}`;
            const companyName = company?.name || 'WorkSphere';
            const approverName = approver?.name || 'Company Administrator';

            const paidDays = (leave as any).paidDays ?? leave.totalDays;
            const unpaidDays = (leave as any).unpaidDays ?? 0;
            const lopDays = (leave as any).lopDays ?? 0;

            const breakdownRows = `
                <tr>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Total Duration:</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">${leave.totalDays} day(s) (${leave.durationType === 'HALF_DAY' ? 'Half Day' : 'Full Day'})</td>
                </tr>
                <tr>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Paid Leave Days:</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #16a34a;">${paidDays} day(s)</td>
                </tr>
                ${unpaidDays > 0 ? `
                <tr>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Unpaid Leave Days:</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #ca8a04;">${unpaidDays} day(s)</td>
                </tr>` : ''}
                ${lopDays > 0 ? `
                <tr>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Loss of Pay (LOP) Days:</td>
                    <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #dc2626;">${lopDays} day(s)</td>
                </tr>` : ''}
            `;

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: #18181b; padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.5px; }
    .content { padding: 32px; color: #27272a; }
    .badge { display: inline-block; background: #dcfce7; color: #166534; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #09090b; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; background: #fafafa; border-radius: 6px; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; font-size: 14px; margin-top: 16px; }
    .footer { padding: 20px 32px; background: #fafafa; border-top: 1px solid #f4f4f5; font-size: 12px; color: #a1a1aa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>WorkSphere &bull; ${companyName}</h1>
    </div>
    <div class="content">
      <div class="badge">&check; Leave Request Approved</div>
      <div class="title">Hello ${employee.name},</div>
      <p style="color: #52525b; line-height: 1.5; font-size: 15px;">
        Your leave request for <strong>${leave.leaveType}</strong> from <strong>${leave.startDate}</strong> to <strong>${leave.endDate}</strong> has been approved by <strong>${approverName}</strong>.
      </p>

      <table class="table">
        <tbody>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Request Reference:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">#${leave._id}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Leave Dates:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">${leave.startDate} to ${leave.endDate}</td>
          </tr>
          ${breakdownRows}
        </tbody>
      </table>

      <a href="${actionUrl}" class="btn" target="_blank">View Leave Details in WorkSphere</a>
    </div>
    <div class="footer">
      This is an automated notification sent by WorkSphere Leave Management for ${companyName}.
    </div>
  </div>
</body>
</html>
`;

            const transporter = getMailTransporter();
            await transporter.sendMail({
                from: mailDefaults.from,
                to: employee.email,
                subject: `[WorkSphere] Leave Request Approved (${leave.startDate} - ${leave.endDate})`,
                html,
                text: `Hello ${employee.name},\n\nYour ${leave.leaveType} leave request from ${leave.startDate} to ${leave.endDate} has been approved by ${approverName}.\n\nTotal: ${leave.totalDays} day(s) (Paid: ${paidDays}, Unpaid: ${unpaidDays}, LOP: ${lopDays}).\n\nView here: ${actionUrl}`,
            });

            await LeaveRequest.findByIdAndUpdate(leaveRequestId, {
                $set: {
                    emailDeliveryStatus: 'SENT',
                    emailSentAt: new Date(),
                },
            });

            return true;
        } catch (err: any) {
            console.error('[LeaveEmailService] Failed to send leave approval email:', err?.message);
            await LeaveRequest.findByIdAndUpdate(leaveRequestId, {
                $set: {
                    emailDeliveryStatus: 'FAILED',
                    emailDeliveryError: err?.message || 'SMTP delivery error',
                },
            }).catch(() => {});
            return false;
        }
    }

    /**
     * Sends an email notification to the employee when a Loss of Pay (LOP) decision is approved/finalized.
     * Never exposes unauthorized salary data and explicitly labels deductions as estimated pending payroll finalization.
     */
    static async sendLopDecisionEmail(lopDecisionId: string): Promise<boolean> {
        try {
            const decision = await LopDecision.findById(lopDecisionId)
                .populate('employeeId', 'name email')
                .populate('approvedBy', 'name email')
                .populate('companyId', 'name')
                .populate('leaveRequestId', 'startDate endDate leaveType')
                .lean();

            if (!decision || decision.status !== 'APPROVED') {
                return false;
            }

            // Prevent duplicate emails
            if (decision.emailDeliveryStatus === 'SENT') {
                return true;
            }

            const employee = decision.employeeId as any;
            if (!employee || !employee.email) {
                return false;
            }

            const company = decision.companyId as any;
            const leave = decision.leaveRequestId as any;
            const approver = decision.approvedBy as any;

            const appUrl = env.APP_URL || 'http://localhost:3000';
            const actionUrl = `${appUrl}/main/attendance?tab=lop`;
            const companyName = company?.name || 'WorkSphere';
            const approverName = approver?.name || 'Company Administrator';

            const calculationBasis =
                decision.calculationMethod === 'FIXED_AMOUNT'
                    ? `Fixed daily deduction rate (${decision.finalDeductionAmount / decision.lopDays} ${decision.currency}/day)`
                    : `Monthly Salary Divisor (Divisor: ${decision.divisorUsed || 30})`;

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px; }
    .card { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { background: #18181b; padding: 24px 32px; color: #ffffff; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.5px; }
    .content { padding: 32px; color: #27272a; }
    .badge { display: inline-block; background: #fee2e2; color: #991b1b; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
    .title { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #09090b; }
    .table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; background: #fafafa; border-radius: 6px; }
    .note { background: #fefce8; border-left: 4px solid #eab308; padding: 12px 16px; font-size: 13px; color: #713f12; margin: 20px 0; border-radius: 4px; line-height: 1.4; }
    .btn { display: inline-block; background: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500; font-size: 14px; }
    .footer { padding: 20px 32px; background: #fafafa; border-top: 1px solid #f4f4f5; font-size: 12px; color: #a1a1aa; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>WorkSphere &bull; ${companyName}</h1>
    </div>
    <div class="content">
      <div class="badge">Loss of Pay (LOP) Decision Finalized</div>
      <div class="title">Hello ${employee.name},</div>
      <p style="color: #52525b; line-height: 1.5; font-size: 15px;">
        A Loss of Pay (LOP) decision has been finalized regarding your leave request for <strong>${decision.month}</strong> by <strong>${approverName}</strong>.
      </p>

      <table class="table">
        <tbody>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Leave Request:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">${leave?.leaveType || 'Leave'} (${leave?.startDate} to ${leave?.endDate})</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Effective Period:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">${decision.month}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Approved LOP Days:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #dc2626;">${decision.lopDays} day(s)</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Calculation Basis:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600; color: #09090b;">${calculationBasis}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; color: #52525b;">Estimated Deduction:</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 700; color: #b91c1c; font-size: 16px;">${decision.currency} ${decision.finalDeductionAmount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div class="note">
        <strong>Please Note:</strong> This is an estimated deduction calculation based on company leave policy. The finalized salary deduction will be reflected in your official monthly payslip after payroll processing.
      </div>

      <a href="${actionUrl}" class="btn" target="_blank">View LOP & Leave Details</a>
    </div>
    <div class="footer">
      This is an automated notification sent by WorkSphere Leave Management for ${companyName}.
    </div>
  </div>
</body>
</html>
`;

            const transporter = getMailTransporter();
            await transporter.sendMail({
                from: mailDefaults.from,
                to: employee.email,
                subject: `[WorkSphere] Loss of Pay (LOP) Decision Finalized - ${decision.month}`,
                html,
                text: `Hello ${employee.name},\n\nA Loss of Pay (LOP) decision for ${decision.month} has been finalized by ${approverName}.\nApproved LOP Days: ${decision.lopDays}\nEstimated Deduction: ${decision.currency} ${decision.finalDeductionAmount}\n\nNote: This is an estimated deduction pending payroll processing.\nView here: ${actionUrl}`,
            });

            await LopDecision.findByIdAndUpdate(lopDecisionId, {
                $set: {
                    emailDeliveryStatus: 'SENT',
                    emailSentAt: new Date(),
                },
            });

            return true;
        } catch (err: any) {
            console.error('[LeaveEmailService] Failed to send LOP decision email:', err?.message);
            await LopDecision.findByIdAndUpdate(lopDecisionId, {
                $set: {
                    emailDeliveryStatus: 'FAILED',
                    emailDeliveryError: err?.message || 'SMTP delivery error',
                },
            }).catch(() => {});
            return false;
        }
    }
}
export default LeaveEmailService;
