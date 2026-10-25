interface Sender { id?: string; url?: string; tab?: { id?: number }; frameId?: number }
export function isSidepanelTranslationSender(sender: Sender, extensionId: string, sidepanelUrl: string) {
  return sender.id === extensionId && sender.url?.split(/[?#]/, 1)[0] === sidepanelUrl;
}
export function isWebTranslationSender(sender: Sender, extensionId: string) {
  return sender.id === extensionId && sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:\/\//i.test(sender.url ?? '');
}
