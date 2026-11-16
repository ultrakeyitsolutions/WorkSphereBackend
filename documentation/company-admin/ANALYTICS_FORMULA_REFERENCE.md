# <span style="color: #065F46;">UWorksphere &mdash; Analytics Formula & KPI Formulation Reference</span>

---

### <span style="color: #047857;">Executive Document Metadata</span>
- **Module:** Production Mathematical Formulas, KPI Specifications & Calculation Engine
- **Target Audience:** Solution Architects, Data Analysts, Product Managers & Operations Leads
- **Document Version:** 2.4.0
- **Classification:** Enterprise Mathematical Reference

---

## <span style="color: #047857;">1. Master Algorithmic Formulation Cheat-Sheet</span>

This document serves as the authoritative mathematical reference for all key performance indicators (KPIs) calculated within UWorksphere.

---

## <span style="color: #047857;">2. Project Health Analytics Formulas (`ProjectHealthService`)</span>

### <span style="color: #0F766E;">2.1 Task Progress Percentage</span>
$$\text{Progress \%} = \begin{cases} 
\text{round}\left(\frac{\text{completedTasksCount}}{\text{totalTasksCount}} \times 100\right) & \text{if } \text{totalTasksCount} > 0 \\ 
0 & \text{otherwise} 
\end{cases}$$

---

### <span style="color: #0F766E;">2.2 Days Remaining Until Milestone Deadline</span>
$$\text{daysRemaining} = \left\lceil \frac{\text{targetEndDate (ms)} - \text{currentTime (ms)}}{1000 \times 60 \times 60 \times 24} \right\rceil$$

---

### <span style="color: #0F766E;">2.3 Authoritative Project Health Classification Rules</span>

```mermaid
flowchart TD
    Start["Input: Project Metrics & Dates"] --> TestDelayed{"Is Deadline Passed & Progress < 100%?\nOR Overdue Tasks >= 8?"}
    TestDelayed -- Yes --> OutDelayed["status = 'delayed'\n(Badge: Amber / Red)"]
    TestDelayed -- No --> TestAtRisk{"Overdue Tasks >= 3?\nOR (Days Remaining <= 3 & Progress < 70%)?\nOR Unresolved Blockers > 0?"}
    TestAtRisk -- Yes --> OutAtRisk["status = 'at_risk'\n(Badge: Yellow)"]
    TestAtRisk -- No --> OutOnTrack["status = 'on_track'\n(Badge: Green Emerald)"]
```

---

## <span style="color: #047857;">3. Attendance & Shift Calculation Formulas (`AttendanceCalculationService`)</span>

### <span style="color: #0F766E;">3.1 Late Arrival Minutes</span>
$$\text{graceThreshold} = \text{scheduledStartTime} + (\text{gracePeriodMinutes} \times 60 \times 1000)$$

$$\text{lateMinutes} = \begin{cases}
\max\left(0, \left\lfloor \frac{\text{actualCheckIn} - \text{graceThreshold}}{60000} \right\rfloor\right) & \text{if } \text{actualCheckIn} > \text{graceThreshold} \\
0 & \text{otherwise (ON\_TIME)}
\end{cases}$$

---

### <span style="color: #0F766E;">3.2 Early Departure Minutes</span>
$$\text{earlyThreshold} = \text{scheduledEndTime} - (\text{earlyCheckoutGraceMinutes} \times 60 \times 1000)$$

$$\text{earlyLeaveMinutes} = \begin{cases}
\max\left(0, \left\lfloor \frac{\text{scheduledEndTime} - \text{actualCheckOut}}{60000} \right\rfloor\right) & \text{if } \text{actualCheckOut} < \text{earlyThreshold} \\
0 & \text{otherwise}
\end{cases}$$

---

### <span style="color: #0F766E;">3.3 Overtime Minutes</span>
$$\text{overtimeMinutes} = \begin{cases}
\max\left(0, \left\lfloor \frac{\text{actualCheckOut} - \text{scheduledEndTime}}{60000} \right\rfloor\right) & \text{if } \text{actualCheckOut} > \text{scheduledEndTime} \\
0 & \text{otherwise}
\end{cases}$$

---

### <span style="color: #0F766E;">3.4 Net Worked Minutes (Interval Accumulator)</span>
$$\text{netWorkedMinutes} = \max\left(0, \left\lfloor \frac{\text{lastCheckOut} - \text{firstCheckIn}}{60000} \right\rfloor - \text{totalBreakMinutes}\right)$$

---

### <span style="color: #0F766E;">3.5 Canonical Attendance Status Hierarchy</span>
$$\text{Status} = \begin{cases}
\text{HOLIDAY} & \text{if Date is Company Holiday} \\
\text{LEAVE} & \text{if Approved Full-Day Leave exists} \\
\text{HALF\_DAY} & \text{if Approved Half-Day Leave exists} \\
\text{WEEK\_OFF} & \text{if Scheduled Non-Working Day and No Punch} \\
\text{HALF\_DAY} & \text{if Punched In} \land (\text{netWorkedMinutes} < \text{halfDayThreshold}) \land \text{Shift Concluded} \\
\text{PRESENT} & \text{if Punched In} \land \text{netWorkedMinutes} \ge \text{halfDayThreshold} \\
\text{ABSENT} & \text{if No Punch} \land \text{Shift Concluded} \land \text{Shift Assigned} \\
\text{PENDING} & \text{otherwise (Shift in progress)}
\end{cases}$$

---

## <span style="color: #047857;">4. Team & Workload Formulas</span>

### <span style="color: #0F766E;">4.1 Team Delivery Velocity</span>
$$\text{teamCompletionRate} = \begin{cases}
\text{round}\left(\frac{\sum \text{Completed Tasks}}{\sum \text{Total Active Tasks}} \times 100\right) & \text{if } \sum \text{Total Tasks} > 0 \\
0 & \text{otherwise}
\end{cases}$$

---

### <span style="color: #0F766E;">4.2 Workload Saturation Index</span>
$$\text{Saturation Index} = \sum_{i=1}^{M} (\text{PriorityWeight}_i \times \text{CriticalityFactor}_i)$$
Where:
- $\text{PriorityWeight}(\text{URGENT}) = 4$
- $\text{PriorityWeight}(\text{HIGH}) = 3$
- $\text{PriorityWeight}(\text{MEDIUM}) = 2$
- $\text{PriorityWeight}(\text{LOW}) = 1$
- $\text{CriticalityFactor} = 1.5$ for `CRITICAL` tasks, $1.0$ for `NON_CRITICAL` tasks.

