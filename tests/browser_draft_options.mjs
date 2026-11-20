import assert from 'node:assert/strict';

/** Edit a pending review's alternatives in the task and request its next version. */
export async function editTaskOptions(page, base, write) {
  const taskDraft = '### Main release plan\n\nShip the synthetic example on Friday.';
  const options = [
    { key: 'main', label: 'Main plan', body: taskDraft },
    { key: 'partner', label: 'Optional partner variation requiring a second team to confirm the release schedule', body: '### Joint announcement\n\nAsk the partner first.' },
  ];
  const revised = '### Revised announcement\n\nConfirm the **joint** schedule first.';
  const task = await write('task.create', { title: 'Synthetic editable review plans', draft: taskDraft });
  const first = await write('review.request', { options, selection: 'one', recipient: 'Synthetic reviewer' }, task.id, task.revision);
  const dialog = page.getByRole('dialog');
  const taskUrl = base + '/#/tasks/' + task.id;
  const heading = name => dialog.getByRole('heading', { name, exact: true });
  const clickWrite = async (name, action) => {
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url() === base + '/api/crew/write' && r.request().postDataJSON()?.action === action),
      dialog.getByRole('button', { name, exact: true }).click(),
    ]);
    assert.equal(response.status(), 200, action);
    return response.json();
  };

  await page.goto(taskUrl);
  await page.reload();
  await heading('Main release plan').waitFor();
  await heading('Joint announcement').waitFor();
  assert.equal(await heading('Main release plan').count(), 1, 'the task presents the draft repeated by option A only once');
  assert.equal(await dialog.getByRole('button', { name: 'Save task', exact: true }).isDisabled(), true);
  assert.ok(await dialog.locator('.crew-dialog-body').evaluate(d => d.scrollWidth <= d.clientWidth + 1), 'long option labels fit the task editor');

  await dialog.getByRole('tablist', { name: 'Option 2 draft view' }).getByRole('tab', { name: 'Edit' }).click();
  const editor = dialog.getByRole('textbox', { name: 'Option 2 draft', exact: true });
  assert.equal(await editor.inputValue(), options[1].body);
  await editor.fill(revised);
  await dialog.getByText('Saving these changes will withdraw the pending review.', { exact: true }).waitFor();
  await clickWrite('Save task', 'task.update');
  await page.goto(base + '/#/approvals/' + first.id);
  await page.reload();
  await dialog.getByText('withdrawn', { exact: true }).waitFor();
  await heading('Joint announcement').waitFor();
  assert.equal(await heading('Revised announcement').count(), 0, 'the withdrawn snapshot keeps the original Markdown');

  await page.goto(taskUrl);
  await page.reload();
  await heading('Revised announcement').waitFor();
  assert.equal(await heading('Main release plan').count(), 1, 'the untouched option stays visible once after reopening');
  await dialog.getByRole('tablist', { name: 'Option 1 draft view' }).getByRole('tab', { name: 'Edit' }).click();
  const revisedMain = '### Main release schedule\n\nShip the synthetic example on Monday.';
  await dialog.getByRole('textbox', { name: 'Option 1 draft', exact: true }).fill(revisedMain);
  assert.ok(await dialog.getByRole('button', { name: 'Request approval', exact: true }).isDisabled());
  const updatedTask = await clickWrite('Save task', 'task.update');
  assert.equal(updatedTask.draft, revisedMain, 'editing the main option keeps the matching task draft in sync');
  await page.goto(taskUrl);
  await page.reload();
  await heading('Main release schedule').waitFor();
  assert.equal(await heading('Main release schedule').count(), 1);
  assert.equal(await heading('Main release plan').count(), 0);
  const next = await clickWrite('Request approval', 'review.request');
  assert.notEqual(next.id, first.id);
  assert.deepEqual(next.options, [{ ...options[0], body: revisedMain }, { ...options[1], body: revised }]);
  assert.equal(next.selection, 'one');
  assert.equal(next.recipient, 'Synthetic reviewer');
  await page.goto(base + '/#/approvals/' + next.id);
  await page.reload();
  await dialog.getByRole('radio', { name: options[1].label, exact: true }).waitFor();
  await heading('Revised announcement').waitFor();
}
