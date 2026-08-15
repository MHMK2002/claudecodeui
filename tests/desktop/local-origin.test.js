import assert from 'node:assert/strict';
import test from 'node:test';

import { isExactVerifiedOrigin } from '../../electron/localOrigin.js';

test('desktop local auth accepts only the exact health-verified origin', () => {
  const verified = 'http://localhost:43123';

  assert.equal(isExactVerifiedOrigin('http://localhost:43123/session/1', verified), true);
  assert.equal(isExactVerifiedOrigin('http://localhost:43124/session/1', verified), false);
  assert.equal(isExactVerifiedOrigin('http://127.0.0.1:43123/session/1', verified), false);
  assert.equal(isExactVerifiedOrigin('https://localhost:43123/session/1', verified), false);
  assert.equal(isExactVerifiedOrigin('not a url', verified), false);
});
