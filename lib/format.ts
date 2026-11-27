export function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatDay(start);
  return `${formatDay(start)} – ${formatDay(end)}`;
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

export const LOAN_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  returned: "Returned",
  cancelled: "Cancelled",
};

export function loanStatusTone(
  status: string,
  isOverdue: boolean,
): "neutral" | "amber" | "green" | "red" | "blue" {
  if (isOverdue) return "red";
  switch (status) {
    case "pending":
      return "amber";
    case "approved":
      return "blue";
    case "returned":
      return "green";
    case "declined":
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

export const ACTIVITY_LABELS: Record<string, string> = {
  request_created: "Request notification",
  request_approved: "Approval notification",
  request_declined: "Decline notification",
  request_cancelled: "Cancellation notification",
  loan_returned: "Return notification",
  notification_delivered: "Notification delivered",
  overdue_reminder_delivered: "Overdue reminder sent",
  workflow_failed: "Workflow failure reported",
};

export function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type.replaceAll("_", " ");
}
