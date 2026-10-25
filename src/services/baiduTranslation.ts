export const BAIDU_TRANSLATION_ENDPOINT = 'https://fanyi-api.baidu.com/ait/api/aiTextTranslate';
const MAX_RESPONSE_BYTES = 128_000;
export type BaiduModel = 'llm' | 'nmt';
export interface BaiduTranslationRequest { appid: string; apiKey: string; text: string; model: BaiduModel; reference?: string }
export interface BaiduTranslationOptions { fetch?: typeof fetch; timeoutMs?: number; signal?: AbortSignal }

/** Safe messages only: upstream bodies, credential-bearing requests and errors never escape. */
export class BaiduTranslationError extends Error {
  constructor(public readonly code: 'configuration' | 'timeout' | 'cancelled' | 'auth' | 'quota' | 'rate' | 'response' | 'network') {
    const messages = {
      configuration: '请先填写有效的百度翻译 APPID 和 API Key。', timeout: '百度翻译等待超时，请稍后手动重试。',
      cancelled: '本次翻译已停止。', auth: '百度翻译认证失败，请检查 APPID、API Key 及服务开通状态。',
      quota: '百度翻译额度或余额不足，请到百度控制台确认。', rate: '百度翻译请求过于频繁，请稍后重试。',
      response: '百度翻译没有返回可用译文。', network: '暂时无法连接百度翻译，请检查网络后重试。',
    };
    super(messages[code]); this.name = 'BaiduTranslationError';
  }
}

function failureCode(code: unknown): BaiduTranslationError['code'] {
  const value = String(code);
  if (['52003', '54001', '58000', '58002', '401', '403'].includes(value)) return 'auth';
  if (['54004'].includes(value)) return 'quota';
  if (['54003', '54005', '429'].includes(value)) return 'rate';
  return 'response';
}

export async function translateBaidu(request: BaiduTranslationRequest, options: BaiduTranslationOptions = {}): Promise<string> {
  if (!/^\d{5,40}$/.test(request.appid) || !request.apiKey.trim() || /[\r\n]/.test(request.apiKey)
    || request.apiKey.length > 512 || !request.text.trim() || request.text.length > 5000
    || !['llm', 'nmt'].includes(request.model) || (request.reference !== undefined
      && (request.model !== 'llm' || typeof request.reference !== 'string' || request.reference.length > 500))) throw new BaiduTranslationError('configuration');
  if (options.signal?.aborted) throw new BaiduTranslationError('cancelled');
  const controller = new AbortController();
  let timedOut = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new BaiduTranslationError('timeout')); }, options.timeoutMs ?? 20_000);
  });
  const cancelled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new BaiduTranslationError(timedOut ? 'timeout' : 'cancelled')), { once: true });
  });
  try {
    const operation = (async () => {
      const response = await (options.fetch ?? fetch)(BAIDU_TRANSLATION_ENDPOINT, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${request.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: request.appid, from: 'en', to: 'zh', q: request.text, model_type: request.model,
          ...(request.reference ? { reference: request.reference } : {}) }),
      });
      if (!response.ok) throw new BaiduTranslationError(failureCode(response.status));
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) throw new BaiduTranslationError('response');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0; let body = '';
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) throw new BaiduTranslationError('response');
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      const data: unknown = JSON.parse(body);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BaiduTranslationError('response');
      const value = data as Record<string, unknown>;
      if (value.error_code !== undefined && !['0', '52000'].includes(String(value.error_code))) throw new BaiduTranslationError(failureCode(value.error_code));
      if (!Array.isArray(value.trans_result) || !value.trans_result.length || value.trans_result.length > 100) throw new BaiduTranslationError('response');
      const parts = value.trans_result as Record<string, unknown>[];
      if (parts.some(part => !part || typeof part.src !== 'string' || typeof part.dst !== 'string' || !part.dst.trim())) throw new BaiduTranslationError('response');
      // Do not accept an unrelated response as the translation of the selected text.
      if (parts.map(part => part.src as string).join('\n').trim() !== request.text.trim()) throw new BaiduTranslationError('response');
      const translation = parts.map(part => (part.dst as string).trim()).join('\n');
      if (translation.length > 20_000) throw new BaiduTranslationError('response');
      return translation;
    })();
    return await Promise.race([operation, deadline, cancelled]);
  } catch (error) {
    if (error instanceof BaiduTranslationError) throw error;
    if (timedOut) throw new BaiduTranslationError('timeout');
    if (controller.signal.aborted) throw new BaiduTranslationError('cancelled');
    throw new BaiduTranslationError(error instanceof SyntaxError ? 'response' : 'network');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    void reader?.cancel().catch(() => undefined);
    controller.abort();
  }
}
