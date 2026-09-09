import { expect, test, type APIRequestContext } from '@playwright/test';

const apiUrl = required('E2E_API_URL');
const userAToken = required('E2E_USER_A_TOKEN');
const userBToken = required('E2E_USER_B_TOKEN');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the deployed release suite.`);
  return value;
}

function auth(token: string) { return { authorization: `Bearer ${token}` }; }

async function createTask(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.post(`${apiUrl}/api/tasks`, { headers: auth(token), data: { prompt: 'Research the capital of France and cite sources.' } });
  expect(response.status()).toBe(202);
  return (await response.json()).data.id;
}

type TaskResponse = { status: string; sources?: unknown };

async function waitForTerminal(request: APIRequestContext, token: string, id: string): Promise<TaskResponse> {
  const deadline = Date.now() + 170_000;
  while (Date.now() < deadline) {
    const response = await request.get(`${apiUrl}/api/tasks/${id}`, { headers: auth(token) });
    expect(response.status()).toBe(200);
    const task = (await response.json()).data as TaskResponse;
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Task ${id} did not reach a terminal state before timeout.`);
}

test.describe.serial('deployed release path', () => {
  test('liveness and readiness are healthy', async ({ request }) => {
    expect((await request.get(`${apiUrl}/health`)).status()).toBe(200);
    expect((await request.get(`${apiUrl}/ready`)).status()).toBe(200);
  });

  test('rejects unauthenticated and cross-user task access', async ({ request }) => {
    expect((await request.get(`${apiUrl}/api/tasks`)).status()).toBe(401);
    const taskId = await createTask(request, userAToken);
    expect((await request.get(`${apiUrl}/api/tasks/${taskId}`, { headers: auth(userBToken) })).status()).toBe(404);
    expect((await request.post(`${apiUrl}/api/tasks/${taskId}/cancel`, { headers: auth(userBToken) })).status()).toBe(404);
    expect((await request.delete(`${apiUrl}/api/tasks/${taskId}`, { headers: auth(userBToken) })).status()).toBe(404);
  });

  test('executes a task, exposes sources, and preserves history', async ({ request }) => {
    const taskId = await createTask(request, userAToken);
    const task = await waitForTerminal(request, userAToken, taskId);
    expect(['completed', 'failed']).toContain(task.status);
    if (task.status === 'completed') expect(Array.isArray(task.sources)).toBeTruthy();
    const history = await request.get(`${apiUrl}/api/tasks`, { headers: auth(userAToken) });
    expect(history.status()).toBe(200);
    expect((await history.json()).data.some((entry: { id: string }) => entry.id === taskId)).toBeTruthy();
  });

  test('cancels an active task and permits deletion once terminal', async ({ request }) => {
    const taskId = await createTask(request, userAToken);
    const cancellation = await request.post(`${apiUrl}/api/tasks/${taskId}/cancel`, { headers: auth(userAToken) });
    expect([200, 409]).toContain(cancellation.status());
    const task = await waitForTerminal(request, userAToken, taskId);
    if (task.status === 'cancelled') expect((await request.delete(`${apiUrl}/api/tasks/${taskId}`, { headers: auth(userAToken) })).status()).toBe(200);
  });
});