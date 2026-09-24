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

export interface PagedTasks {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TasksQuery {
  page?: number;
  pageSize?: number;
  done?: boolean;
  q?: string;
}
