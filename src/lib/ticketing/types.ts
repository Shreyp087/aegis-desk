export type TicketStatus = "open" | "in_progress" | "resolved";
export type TicketPriority = "low" | "medium" | "high";

export type TicketDto = {
  _id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  assignedAdmin: {
    _id: string;
    name: string;
    email: string;
  } | null;
  adminResponse: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};
