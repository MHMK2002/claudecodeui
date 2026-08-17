import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  formatMessageClockTime,
  formatMessageFullDateTime,
  parseMessageTimestamp,
} from '../../utils/messageTimestamp';

import MessageTimestamp from './MessageTimestamp';

const TIMESTAMP = '2026-08-16T10:02:00.000Z';
const UTC_FORMAT = { locale: 'en-GB', timeZone: 'UTC' } as const;

test('formats message time as stable 24-hour HH:mm without seconds', () => {
  assert.equal(formatMessageClockTime(TIMESTAMP, UTC_FORMAT), '10:02');
  assert.equal(formatMessageFullDateTime(TIMESTAMP, UTC_FORMAT), '16 Aug 2026, 10:02');
});

test('renders semantic time with machine-readable and full-date metadata', () => {
  const html = renderToStaticMarkup(
    <MessageTimestamp timestamp={TIMESTAMP} formatOptions={UTC_FORMAT} />,
  );

  assert.match(html, /^<time /);
  assert.match(html, /dateTime="2026-08-16T10:02:00\.000Z"/);
  assert.match(html, /title="16 Aug 2026, 10:02"/);
  assert.match(html, /aria-label="16 Aug 2026, 10:02"/);
  assert.match(html, />10:02<\/time>$/);
});

test('invalid or missing timestamps render nothing instead of Invalid Date', () => {
  assert.equal(parseMessageTimestamp('not-a-date'), null);
  assert.equal(formatMessageClockTime(undefined, UTC_FORMAT), null);
  assert.equal(
    renderToStaticMarkup(<MessageTimestamp timestamp="not-a-date" formatOptions={UTC_FORMAT} />),
    '',
  );
});
