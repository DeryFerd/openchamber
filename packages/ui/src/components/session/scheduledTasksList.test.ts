import { describe, expect, test } from 'bun:test';

import type { ScheduledTask } from '@/lib/scheduledTasksApi';

import { orderScheduledTasks, tasksForProject, type ScheduledTaskList } from './scheduledTasksList';

const task = (overrides: Partial<ScheduledTask> & { id: string }): ScheduledTask => ({
  name: overrides.id,
  enabled: true,
  schedule: { kind: 'daily', time: '09:00' },
  execution: { prompt: 'run' },
  state: { createdAt: 0, updatedAt: 0 },
  ...overrides,
});

describe('tasksForProject', () => {
  test('shows a loaded list only under the project it was loaded for', () => {
    // A slow request for the project the dialog has left must not put its
    // tasks under the project the user is on now.
    const list: ScheduledTaskList = { projectID: 'project-a', tasks: [task({ id: 'a-1' })] };

    expect(tasksForProject(list, 'project-a')).toHaveLength(1);
    expect(tasksForProject(list, 'project-b')).toEqual([]);
  });

  test('shows nothing before a project has loaded', () => {
    expect(tasksForProject({ projectID: '', tasks: [] }, 'project-a')).toEqual([]);
  });
});

describe('orderScheduledTasks', () => {
  test('puts enabled tasks first, then by name, then by the next run', () => {
    const ordered = orderScheduledTasks([
      task({ id: 'paused', enabled: false, name: 'alpha' }),
      task({ id: 'zeta', name: 'zeta' }),
      task({ id: 'alpha-later', name: 'alpha', state: { createdAt: 0, updatedAt: 0, nextRunAt: 200 } }),
      task({ id: 'alpha-sooner', name: 'alpha', state: { createdAt: 0, updatedAt: 0, nextRunAt: 100 } }),
    ]);

    expect(ordered.map((entry) => entry.id)).toEqual(['alpha-sooner', 'alpha-later', 'zeta', 'paused']);
  });

  test('leaves the response array untouched', () => {
    const response = [task({ id: 'b' }), task({ id: 'a' })];

    orderScheduledTasks(response);

    expect(response.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});
