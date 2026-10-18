import type { ScheduledTask } from '@/lib/scheduledTasksApi';

/** A loaded task list together with the project whose tasks it holds. */
export type ScheduledTaskList = {
    projectID: string;
    tasks: ScheduledTask[];
};

export const EMPTY_TASK_LIST: ScheduledTaskList = { projectID: '', tasks: [] };

/** Enabled tasks first, then by name, then by the next run. */
export const orderScheduledTasks = (tasks: readonly ScheduledTask[]): ScheduledTask[] => (
    [...tasks].sort((a, b) => {
        if (a.enabled !== b.enabled) {
            return a.enabled ? -1 : 1;
        }
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) {
            return byName;
        }
        return (a.state?.nextRunAt || Number.MAX_SAFE_INTEGER) - (b.state?.nextRunAt || Number.MAX_SAFE_INTEGER);
    })
);

/**
 * The rows to show for `projectID`.
 *
 * A response belongs to the project it was requested for: a slower request
 * for a project the dialog has since left must not surface its rows under the
 * one the user is on now.
 */
export const tasksForProject = (list: ScheduledTaskList, projectID: string): ScheduledTask[] => (
    list.projectID === projectID ? list.tasks : []
);
