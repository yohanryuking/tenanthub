export interface Task {
  id: string;
  orgId: string;
  title: string;
  description: string | null;
  done: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
