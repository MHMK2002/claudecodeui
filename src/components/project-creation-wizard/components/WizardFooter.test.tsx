import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WizardFooter from './WizardFooter';

const noOperation = () => undefined;

test('a non-cancellable finalizing clone shows status instead of another Cancel action', () => {
  const markup = renderToStaticMarkup(
    <WizardFooter
      step={3}
      mode="clone"
      isCreating
      isCancelling={false}
      cancellationUnavailable
      retryLabel={null}
      onClose={noOperation}
      onBack={noOperation}
      onAdvance={noOperation}
      onCreate={noOperation}
      onCancelClone={noOperation}
    />,
  );

  assert.match(markup, /Finishing/);
  assert.doesNotMatch(markup, />Cancel clone</);
});
