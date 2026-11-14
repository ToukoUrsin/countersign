/** bun test server/escapes.test.ts — which commit messages count as a revert of a countersigned pull request. */
import { expect, test } from 'bun:test';
import { revertsPr } from './escapes';

const pr = { number: 12, title: 'Add VAT rounding per line (REQ-7)', headSha: 'a08109d342673e273ce3123ddadf43bb9146069b', mergeSha: '5f3c2aa9e0b1c7d4e8f6a1b2c3d4e5f60718293a' };

test('a git revert of the merge commit', () => {
  expect(revertsPr('Revert "Merge pull request #12 from agent/issue-7"\n\nThis reverts commit 5f3c2aa9e0b1c7d4e8f6a1b2c3d4e5f60718293a, reversing\nchanges made to 1111111.', pr)).toBe(true);
});
test('a revert that names the head commit by short sha', () => {
  expect(revertsPr('Back out the rounding change\n\nThis reverts commit a08109d.', pr)).toBe(true);
});
test("GitHub's revert button: quoted squash title with the number", () => {
  expect(revertsPr('Revert "Add VAT rounding per line (REQ-7) (#12)" (#15)', pr)).toBe(true);
});
test('a revert quoting the exact title without a number', () => {
  expect(revertsPr('Revert "Add VAT rounding per line (REQ-7)"', pr)).toBe(true);
});
test('a revert of some other pull request is not ours, even when ours is the revert', () => {
  expect(revertsPr('Revert "Add CSV export (#9)" (#12)', pr)).toBe(false);
  expect(revertsPr('Revert "Add CSV export (#9)"\n\nThis reverts commit 9999999aaaaaaa.', pr)).toBe(false);
});
test('an ordinary commit that mentions the pull request is not a revert', () => {
  expect(revertsPr('Follow-up to #12: document the rounding rule', pr)).toBe(false);
  expect(revertsPr('Fix typo in revert instructions (#12)', pr)).toBe(false);
});
