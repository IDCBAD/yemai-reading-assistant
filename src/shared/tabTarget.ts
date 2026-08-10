export function isDefinitelyUnsupportedPage(url: string | undefined) {
  return Boolean(url && !/^https?:/u.test(url));
}

export function hasDefiniteUrlMismatch(actualUrl: string | undefined, expectedUrl: string | undefined) {
  return Boolean(actualUrl && expectedUrl && actualUrl !== expectedUrl);
}
